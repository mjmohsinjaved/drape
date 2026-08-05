import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, Interval } from '@nestjs/schedule';

import { MILLISECONDS_PER_HOUR } from '@library/common';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { AlertingService } from '@api/modules/notifications/services/alerting.service';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import {
  DEFAULT_DELETION_SLA_HOURS,
  DELETION_SLA_WARNING_FRACTION,
  DELETION_SWEEP_MS,
  ORPHAN_SWEEP_CRON,
  PURGE_CRON,
} from '../constants/retention.constants';
import { AccountDeletionService, overdueBefore } from '../services/account-deletion.service';
import { OrphanSweepService } from '../services/orphan-sweep.service';
import { PurgeService } from '../services/purge.service';

/** Names used in the E-14 alert copy and in the audit rows. */
export const PURGE_JOB_NAME = 'photo-retention-purge';
export const DELETION_JOB_NAME = 'account-deletion-purge';
export const ORPHAN_SWEEP_JOB_NAME = 'storage-orphan-sweep';

/**
 * **The three scheduled jobs §9.3 asks for, and the E-14 alert when any of them fails.**
 *
 * | Job | Cadence | PRD / ARCHITECTURE |
 * | --- | --- | --- |
 * | Photo retention purge | nightly, 03:00 | §9.3 — "person photos deleted 30 days after last account activity" |
 * | Account deletion sweep | every 15 minutes | A-20, C-38 — "completes within 24 hours" |
 * | Storage orphan sweep | hourly, :25 | §3.5 step 4, §3.2 requirement 4 — an object with no owning row, and `.tmp` |
 *
 * The third exists because the first two both operate on **rows**, and the leak §3.5 step
 * 4 describes is an object with no row at all: a redeemed upload ticket whose `POST
 * /person-photos` never arrived is a photograph that `PurgeService` cannot see, `GET
 * /me/data` cannot show her, and `deletion_log` has never heard of. See
 * {@link OrphanSweepService} for the full argument, including why it does not weaken C-27.
 *
 * ### No job can overlap itself, and all can be cancelled
 *
 * `@Cron` and `@Interval` both fire on a schedule regardless of whether the previous run
 * finished. The services own the guard — `PurgeService.isRunning`,
 * `AccountDeletionService.isRunning` and `OrphanSweepService.isRunning` — because that is
 * where the state that must not be re-entered lives. On shutdown this hook calls
 * `cancel()` on all three; a run in flight finishes the account, photograph or object it
 * is on and stops. Work is never left half done, only not yet started.
 *
 * ### A failed purge is an alert, not a log line
 *
 * E-14 lists "purge job failure" among the five conditions that page an operator, and
 * E-17 puts it in the runbook. Two things raise it here:
 *
 *  - **a run that threw** — the purge is broken and photographs are accumulating past
 *    their retention date, which is a compliance failure that gets worse every day;
 *  - **a deletion request approaching its SLA** — at
 *    {@link DELETION_SLA_WARNING_FRACTION} of `DELETION_SLA_HOURS`, so an operator hears
 *    about it with hours left rather than after C-38's promise has already been broken.
 *
 * The alert goes through `notifications`' outbox, so it survives the mail server being
 * down — which, on the kind of night a purge fails, it may well be.
 */
@Injectable()
export class RetentionProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    private readonly purge: PurgeService,
    private readonly deletions: AccountDeletionService,
    private readonly orphans: OrphanSweepService,
    private readonly alerts: AlertingService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleDestroy(): void {
    this.purge.cancel();
    this.deletions.cancel();
    this.orphans.cancel();
  }

  /* -----------------------------------------------------------------------------------------
   * §9.3 — the nightly photo purge
   * -------------------------------------------------------------------------------------- */

  @Cron(PURGE_CRON, { name: PURGE_JOB_NAME })
  async runPhotoPurge(): Promise<void> {
    await this.photoPurgeOnce();
  }

  /**
   * One purge run, with the E-14 alert on failure.
   *
   * Separated from the decorated method so a test drives it without a scheduler, and so
   * the cron entry point holds nothing but the schedule.
   */
  async photoPurgeOnce(now: Date = new Date()): Promise<void> {
    const startedAt = now;

    try {
      const report = await this.purge.purgeExpiredPhotos(now);

      if (report.photosDeleted > 0) {
        this.events.emit(
          AUDIT_RECORD_EVENT,
          new AuditRecordEvent({
            action: AUDIT_ACTIONS.PURGE_JOB_COMPLETED,
            targetType: AUDIT_TARGET_TYPES.PERSON_PHOTO,
            actorId: null,
            actorRole: null,
            targetLabel: PURGE_JOB_NAME,
            metadata: {
              photosDeleted: report.photosDeleted,
              storageKeysDeleted: report.storageKeysDeleted,
              bytesReclaimed: report.bytesReclaimed,
              datesRecomputed: report.datesRecomputed,
              cancelled: report.cancelled,
            },
          }),
        );
      }
    } catch (error: unknown) {
      await this.raisePurgeFailure(PURGE_JOB_NAME, startedAt, error, () =>
        this.purge.countDue(now),
      );
    }
  }

  /* -----------------------------------------------------------------------------------------
   * A-20 / C-38 — the deletion sweep
   * -------------------------------------------------------------------------------------- */

  @Interval(DELETION_SWEEP_MS)
  async runDeletionSweep(): Promise<void> {
    await this.deletionSweepOnce();
  }

  /** One deletion sweep, plus the SLA check that fires before the promise breaks. */
  async deletionSweepOnce(now: Date = new Date()): Promise<void> {
    const startedAt = now;

    try {
      const { completed, failed } = await this.deletions.sweep(now);

      if (completed > 0) {
        this.logger.log(`Completed ${completed} account deletion(s) within the SLA (A-20, C-38).`);
      }

      if (failed > 0) {
        await this.raisePurgeFailure(
          DELETION_JOB_NAME,
          startedAt,
          new Error(`${failed} account deletion(s) could not be completed.`),
          () => this.pendingCount(now),
        );
        return;
      }

      await this.warnIfApproachingSla(now);
    } catch (error: unknown) {
      await this.raisePurgeFailure(DELETION_JOB_NAME, startedAt, error, () =>
        this.pendingCount(now),
      );
    }
  }

  /* -----------------------------------------------------------------------------------------
   * §3.5 step 4 / §3.2 requirement 4 — the orphan sweep
   * -------------------------------------------------------------------------------------- */

  @Cron(ORPHAN_SWEEP_CRON, { name: ORPHAN_SWEEP_JOB_NAME })
  async runOrphanSweep(): Promise<void> {
    await this.orphanSweepOnce();
  }

  /**
   * One orphan sweep, with the E-14 alert on failure.
   *
   * A failed orphan sweep is an alert for the same reason a failed photo purge is: an
   * object with no owning row is invisible to every other mechanism in §9.3, so a sweep
   * that has been broken for a fortnight is a fortnight of photographs accumulating
   * somewhere nobody is looking — including the consumer, who cannot see them in
   * `GET /me/data` and therefore cannot ask for them to go.
   *
   * The pending count reported to the alert is the photo backlog, which is the number an
   * operator can act on; there is no cheap count of "objects with no row" that does not
   * repeat the sweep itself.
   */
  async orphanSweepOnce(now: Date = new Date()): Promise<void> {
    const startedAt = now;

    try {
      const report = await this.orphans.sweepOnce(now);
      const deleted =
        report.personPhotos.deleted +
        report.renders.deleted +
        report.exports.deleted +
        report.temporaryFilesDeleted;

      if (deleted > 0) {
        this.events.emit(
          AUDIT_RECORD_EVENT,
          new AuditRecordEvent({
            action: AUDIT_ACTIONS.PURGE_JOB_COMPLETED,
            targetType: AUDIT_TARGET_TYPES.DELETION_LOG,
            actorId: null,
            actorRole: null,
            targetLabel: ORPHAN_SWEEP_JOB_NAME,
            // Counts and byte totals only. Never a key (E-12).
            metadata: {
              personPhotoObjectsDeleted: report.personPhotos.deleted,
              renderObjectsDeleted: report.renders.deleted,
              exportArchivesDeleted: report.exports.deleted,
              temporaryFilesDeleted: report.temporaryFilesDeleted,
              bytesReclaimed:
                report.personPhotos.bytesReclaimed +
                report.renders.bytesReclaimed +
                report.exports.bytesReclaimed,
              cancelled: report.cancelled,
            },
          }),
        );
      }
    } catch (error: unknown) {
      await this.raisePurgeFailure(ORPHAN_SWEEP_JOB_NAME, startedAt, error, () =>
        this.purge.countDue(now),
      );
    }
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * E-14 — "purge job failure".
   *
   * The pending count is fetched lazily and defensively: whatever broke the purge may
   * also break the count, and an alert that cannot be raised because it could not
   * calculate a number is the worst possible failure mode for an alert.
   */
  private async raisePurgeFailure(
    jobName: string,
    startedAt: Date,
    error: unknown,
    pending: () => Promise<number>,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    const failedAt = new Date();

    this.logger.error(`${jobName} failed: ${reason}`);

    let pendingDeletions = 0;
    try {
      pendingDeletions = await pending();
    } catch {
      this.logger.warn('The pending count could not be read; the alert goes out without it.');
    }

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.PURGE_JOB_FAILED,
        targetType: AUDIT_TARGET_TYPES.DELETION_LOG,
        actorId: null,
        actorRole: null,
        targetLabel: jobName,
        metadata: { reason, pendingDeletions },
      }),
    );

    try {
      await this.alerts.purgeJobFailed({
        jobName,
        startedAt,
        failedAt,
        attempts: 1,
        pendingDeletions,
        errorSummary: reason.slice(0, 500),
      });
    } catch (alertError: unknown) {
      this.logger.error(
        'The purge-failure alert could not be queued: ' +
          `${alertError instanceof Error ? alertError.message : String(alertError)}`,
      );
    }
  }

  /**
   * Raises the E-14 alert when a request is close to breaching the SLA but has not yet.
   *
   * Alerting at 100% would tell an operator the promise had already been broken. At
   * {@link DELETION_SLA_WARNING_FRACTION} there is still time to act, which is the only
   * thing that distinguishes an alert from a post-mortem.
   */
  private async warnIfApproachingSla(now: Date): Promise<void> {
    const cutoff = overdueBefore(now, this.slaHours() * DELETION_SLA_WARNING_FRACTION);
    const overdue = await this.deletions.countOverdue(cutoff);

    if (overdue === 0) {
      return;
    }

    this.logger.warn(
      `${overdue} deletion request(s) are past ${Math.round(DELETION_SLA_WARNING_FRACTION * 100)}% ` +
        'of the SLA and not yet complete (C-38, A-20).',
    );

    await this.alerts.purgeJobFailed({
      jobName: DELETION_JOB_NAME,
      startedAt: cutoff,
      failedAt: now,
      attempts: 1,
      pendingDeletions: overdue,
      errorSummary:
        `${overdue} deletion request(s) have not completed and are approaching the ` +
        `${this.slaHours()}-hour SLA (C-38, A-20).`,
    });
  }

  private async pendingCount(now: Date): Promise<number> {
    return this.deletions.countOverdue(new Date(now.getTime() + MILLISECONDS_PER_HOUR));
  }

  private slaHours(): number {
    return this.config.get<number>('DELETION_SLA_HOURS') ?? DEFAULT_DELETION_SLA_HOURS;
  }
}
