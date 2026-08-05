import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, Interval } from '@nestjs/schedule';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { AlertingService } from '@api/modules/notifications/services/alerting.service';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import {
  DEFAULT_DELETION_SLA_HOURS,
  DELETION_SLA_WARNING_FRACTION,
  DELETION_SWEEP_MS,
  PURGE_CRON,
} from '../constants/retention.constants';
import { AccountDeletionService, overdueBefore } from '../services/account-deletion.service';
import { PurgeService } from '../services/purge.service';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/** Names used in the E-14 alert copy and in the audit rows. */
export const PURGE_JOB_NAME = 'photo-retention-purge';
export const DELETION_JOB_NAME = 'account-deletion-purge';

/**
 * **The two scheduled jobs §9.3 asks for, and the E-14 alert when either fails.**
 *
 * | Job | Cadence | PRD |
 * | --- | --- | --- |
 * | Photo retention purge | nightly, 03:00 | §9.3 — "person photos deleted 30 days after last account activity" |
 * | Account deletion sweep | every 15 minutes | A-20, C-38 — "completes within 24 hours" |
 *
 * ### Neither job can overlap itself, and both can be cancelled
 *
 * `@Cron` and `@Interval` both fire on a schedule regardless of whether the previous run
 * finished. The services own the guard — `PurgeService.isRunning` and
 * `AccountDeletionService.isRunning` — because that is where the state that must not be
 * re-entered lives. On shutdown this hook calls `cancel()` on both; a run in flight
 * finishes the account or photograph it is on, in its own transaction, and stops. Work
 * is never left half done, only not yet started.
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
    private readonly alerts: AlertingService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  onModuleDestroy(): void {
    this.purge.cancel();
    this.deletions.cancel();
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
