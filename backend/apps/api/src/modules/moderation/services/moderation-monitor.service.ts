import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { AlertingService } from '@api/modules/notifications/services/alerting.service';

import {
  ABUSE_WINDOW_MINUTES,
  AUTH_ANOMALY_FAILURE_THRESHOLD,
  AUTH_ANOMALY_SPREAD_THRESHOLD,
  MODERATION_BACKLOG_MIN_OVERDUE,
  MODERATION_BACKLOG_THRESHOLD_HOURS,
  MODERATION_SWEEP_MS,
} from '../constants/moderation.constants';

import { AbuseService } from './abuse.service';
import { ModerationQueueService } from './moderation-queue.service';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_MINUTE = 60_000;

/** What one sweep found. Returned so a test drives it without waiting on a timer. */
export interface SweepReport {
  readonly pending: number;
  readonly overdue: number;
  readonly backlogAlerted: boolean;
  readonly anomaliesAlerted: number;
}

/**
 * **Two of the five E-14 conditions — the two only this module can see.**
 *
 * > "Alerts on: … **moderation queue backlog**, and **authentication anomalies**."
 *
 * Both are questions about tables this module owns or reads (`moderation_items` §4.29,
 * `auth_attempts` §4.7), so the detection lives here and only the *raising* is
 * delegated. `notifications` never queries a feature table; this never composes copy.
 * That split is what keeps the dependency edge one-way and uncycled.
 *
 * ### Why the queue backlog is an alert at all
 *
 * A pending item is not a task in a list. It is a consumer who uploaded a photograph,
 * was told to wait, and cannot generate anything until somebody looks. The
 * `moderation-backlog-alert` copy says so in as many words — "every waiting item is a
 * blocked account" — and the threshold is set in hours, not in items, because what
 * matters is how long she has been waiting rather than how many of her there are.
 *
 * ### Why an anomaly needs a spread, not just a count
 *
 * S-6 already locks an individual account out after five failures in fifteen minutes,
 * so counting failures alone would page an operator every time somebody mistypes a
 * password on a bad morning. An anomaly is a *distributed* burst: many failures across
 * many addresses or many accounts. Both thresholds have to be crossed together, which
 * is the difference between a signal and a nuisance.
 *
 * ### Overlap and shutdown
 *
 * `@Interval` fires on a timer regardless of whether the previous sweep finished, so
 * the `running` flag — not the timer — is what prevents two sweeps racing. A sweep in
 * flight when the process is shutting down finishes its query and then stops; nothing
 * here holds a transaction open, so there is nothing to roll back.
 */
@Injectable()
export class ModerationMonitorService implements OnModuleDestroy {
  private readonly logger = new Logger(ModerationMonitorService.name);

  private running = false;
  private stopped = false;

  constructor(
    private readonly queue: ModerationQueueService,
    private readonly abuse: AbuseService,
    private readonly alerts: AlertingService,
  ) {}

  @Interval(MODERATION_SWEEP_MS)
  async tick(): Promise<void> {
    await this.sweepOnce();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /**
   * One pass over both conditions.
   *
   * Never throws. A sweep is a background observer: a failure to *look* must not become
   * an unhandled rejection in a process that is otherwise serving requests correctly,
   * and the failure to look is itself logged at `error`, which is the signal an
   * operator has that the observer is blind.
   */
  async sweepOnce(now: Date = new Date()): Promise<SweepReport> {
    if (this.running || this.stopped) {
      return { pending: 0, overdue: 0, backlogAlerted: false, anomaliesAlerted: 0 };
    }

    this.running = true;
    try {
      const backlog = await this.checkBacklog(now);
      const anomaliesAlerted = await this.checkAuthAnomalies(now);
      return { ...backlog, anomaliesAlerted };
    } catch (error: unknown) {
      this.logger.error(
        `The moderation and abuse sweep could not complete: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { pending: 0, overdue: 0, backlogAlerted: false, anomaliesAlerted: 0 };
    } finally {
      this.running = false;
    }
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async checkBacklog(
    now: Date,
  ): Promise<{ pending: number; overdue: number; backlogAlerted: boolean }> {
    const summary = await this.queue.pendingSummary();

    if (summary.oldestPendingAt === null) {
      return { pending: summary.pending, overdue: 0, backlogAlerted: false };
    }

    const threshold = new Date(
      now.getTime() - MODERATION_BACKLOG_THRESHOLD_HOURS * MILLISECONDS_PER_HOUR,
    );
    const overdue = await this.queue.countOverdue(threshold);

    if (overdue < MODERATION_BACKLOG_MIN_OVERDUE) {
      return { pending: summary.pending, overdue, backlogAlerted: false };
    }

    await this.alerts.moderationBacklog({
      pendingCount: summary.pending,
      overdueCount: overdue,
      thresholdHours: MODERATION_BACKLOG_THRESHOLD_HOURS,
      oldestPendingAt: summary.oldestPendingAt,
    });

    return { pending: summary.pending, overdue, backlogAlerted: true };
  }

  /**
   * E-14 authentication anomalies.
   *
   * `AlertingService.authenticationAnomaly` meters and logs rather than emails — see
   * its own comment for why (there is no operator template for this condition in
   * `@library/notifications`, which is not this module's to extend). The detection is
   * complete either way, so closing that gap is a template file and nothing here.
   */
  private async checkAuthAnomalies(now: Date): Promise<number> {
    const since = new Date(now.getTime() - ABUSE_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE);
    const signals = await this.abuse.authAnomaliesSince(since);

    let raised = 0;
    for (const signal of signals) {
      if (!isAnomalous(signal.failures, signal.distinctIps, signal.distinctAccounts)) {
        continue;
      }

      this.alerts.authenticationAnomaly({
        route: signal.route,
        failures: signal.failures,
        distinctIps: signal.distinctIps,
        distinctAccounts: signal.distinctAccounts,
        windowMinutes: ABUSE_WINDOW_MINUTES,
      });
      raised += 1;
    }

    return raised;
  }
}

/**
 * Both conditions, together: enough failures **and** enough spread.
 *
 * Exported because it is the whole judgement and it is worth testing from an array
 * literal rather than through a repository (E-5).
 */
export function isAnomalous(
  failures: number,
  distinctIps: number,
  distinctAccounts: number,
): boolean {
  if (failures < AUTH_ANOMALY_FAILURE_THRESHOLD) {
    return false;
  }
  return (
    distinctIps >= AUTH_ANOMALY_SPREAD_THRESHOLD ||
    distinctAccounts >= AUTH_ANOMALY_SPREAD_THRESHOLD
  );
}
