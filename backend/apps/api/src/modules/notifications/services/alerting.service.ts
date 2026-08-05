import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { METRICS, MetricsService, Role, UserStatus } from '@library/common';
import { TemplateId, type TemplatePropsMap } from '@library/notifications';

import { User } from '@api/modules/users/entities/user.entity';

import { ALERT_DEDUPE_WINDOW_MS } from '../constants/notification.constants';
import { NotificationChannel } from '../enums/notification-channel.enum';

import { OutboxService } from './outbox.service';

/** The five templates this service is allowed to send. Operator copy, no consumer copy. */
export type OperatorAlertTemplate =
  | TemplateId.BUDGET_WARNING_80
  | TemplateId.BUDGET_EXHAUSTED_ADMIN
  | TemplateId.PURGE_JOB_FAILED
  | TemplateId.MODERATION_BACKLOG_ALERT
  | TemplateId.GENERATION_FAILURE_RATE_ALERT;

/** E-14 — "budget at 80% and 100%". */
export interface BudgetAlertInput {
  readonly period: string;
  readonly used: number;
  readonly limit: number;
  /** Percent consumed, 0–100. */
  readonly percentUsed: number;
  /** `BUDGET_WARN_PERCENT` as a percentage, 0–100. */
  readonly warnPercent: number;
  readonly resetsAt: Date;
  /** Consumers refused a generation since the ceiling was reached. Zero at the warning. */
  readonly affectedConsumers?: number;
}

/** E-14 — "purge job failure". */
export interface PurgeFailureAlertInput {
  /** e.g. `photo-retention-purge`, `account-deletion-purge`. */
  readonly jobName: string;
  readonly startedAt: Date;
  readonly failedAt: Date;
  readonly attempts: number;
  /** Subjects the run could not finish — the number §9.3 asks an operator to drive to zero. */
  readonly pendingDeletions: number;
  /** Operator-facing summary. Redacted by the caller; never a storage key (E-12). */
  readonly errorSummary: string;
}

/** E-14 — "moderation queue backlog". */
export interface ModerationBacklogAlertInput {
  readonly pendingCount: number;
  readonly overdueCount: number;
  readonly thresholdHours: number;
  readonly oldestPendingAt: Date;
}

/** E-14 — "generation failure rate above 4%". */
export interface GenerationFailureAlertInput {
  readonly windowMinutes: number;
  readonly windowStartedAt: Date;
  readonly totalGenerations: number;
  readonly failedGenerations: number;
  /** Observed rate, 0–100. */
  readonly failureRatePercent: number;
  /** E-14 sets the threshold at 4. */
  readonly thresholdPercent: number;
  /** The `ErrorCode` behind most of them, or null when there is no clear leader. */
  readonly topFailureReason: string | null;
}

/** E-14 — "authentication anomalies". */
export interface AuthenticationAnomalyAlertInput {
  /** `LOGIN`, `SIGNUP`, `PASSWORD_RESET`, `OTP`, `TWOFA` — `auth_attempts.route` (§4.7). */
  readonly route: string;
  readonly failures: number;
  readonly distinctIps: number;
  readonly distinctAccounts: number;
  readonly windowMinutes: number;
}

/**
 * **The E-14 alert surface.**
 *
 * > "Alerts on: generation failure rate above 4%, budget at 80% and 100%, purge job
 * > failure, moderation queue backlog, and authentication anomalies."
 *
 * ### Every alert goes through the outbox
 *
 * Not through `NotificationsService` directly. An alert about the platform being
 * unhealthy is the *worst* moment to depend on a synchronous SMTP round trip: the
 * purge job that just failed would then also fail to say so, and the one signal an
 * operator had would be gone. A row committed to `notifications_outbox` survives the
 * mail server being down, the process being restarted, and the alert being raised from
 * inside a `catch`.
 *
 * ### Told once, not once per sweep
 *
 * Each alert carries a `dedupeKey` bucketed to {@link ALERT_DEDUPE_WINDOW_MS}, so a
 * condition that persists for six hours reaches an operator once an hour rather than
 * once every sweep. `UQ_notifications_outbox_dedupe` (§4.32) enforces it in the
 * database — a flag in memory would forget across a restart, and a restart is exactly
 * what tends to follow an alert.
 *
 * The budget alerts are the deliberate exception: their key carries the **period and
 * the threshold** rather than a time bucket, because `BudgetService.emitThresholdEvents`
 * already fires them only on the charge that *crossed* the line. There is one per month
 * per threshold and it must not be suppressed by an unrelated alert an hour earlier.
 *
 * ### The gap, stated plainly
 *
 * Four of the five conditions have templates in `@library/notifications` and are wired
 * to them. **Authentication anomalies have no template** — the registry ships
 * seventeen and none is operator copy for a credential-stuffing burst — and that
 * library is not this module's to extend. So {@link authenticationAnomaly} meters and
 * logs the condition rather than emailing it: `auth.denied` carries the count and the
 * route, and the structured `warn` line names both. Adding
 * `authentication-anomaly.template.ts` to the registry is the only change needed to
 * close it, and this method's body grows by one call.
 */
@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly outbox: OutboxService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  /** E-14 — the soft warning. Fired by `QUOTA_EVENTS.BUDGET_WARNING_REACHED` (A-29). */
  async budgetWarning(input: BudgetAlertInput): Promise<void> {
    this.metrics.gauge(METRICS.BUDGET_BURN_PERCENT, input.percentUsed, { period: input.period });
    this.metrics.increment(METRICS.BUDGET_WARNING_FIRED, { period: input.period });

    await this.toEveryAdmin(
      TemplateId.BUDGET_WARNING_80,
      {
        period: input.period,
        usedGenerations: input.used,
        budgetGenerations: input.limit,
        usedPercent: input.percentUsed,
        warnPercent: input.warnPercent,
        resetsAt: input.resetsAt,
        usageUrl: this.adminUrl('/admin/usage'),
      },
      `budget-warning:${input.period}`,
    );
  }

  /** E-14 — the hard stop. A-29: the catalog stays browsable; generation does not. */
  async budgetExhausted(input: BudgetAlertInput): Promise<void> {
    this.metrics.increment(METRICS.BUDGET_EXHAUSTED, { period: input.period });

    await this.toEveryAdmin(
      TemplateId.BUDGET_EXHAUSTED_ADMIN,
      {
        period: input.period,
        budgetGenerations: input.limit,
        exhaustedAt: new Date(),
        resetsAt: input.resetsAt,
        affectedConsumers: input.affectedConsumers ?? 0,
        settingsUrl: this.adminUrl('/admin/settings'),
      },
      `budget-exhausted:${input.period}`,
    );
  }

  /** E-14 — the §9.3 purge did not complete. Raised by `retention`, from inside its `catch`. */
  async purgeJobFailed(input: PurgeFailureAlertInput): Promise<void> {
    await this.toEveryAdmin(
      TemplateId.PURGE_JOB_FAILED,
      {
        jobName: input.jobName,
        startedAt: input.startedAt,
        failedAt: input.failedAt,
        attempts: input.attempts,
        pendingDeletions: input.pendingDeletions,
        errorSummary: input.errorSummary,
        retentionUrl: this.adminUrl('/admin/retention'),
      },
      this.bucketedKey(`purge-failed:${input.jobName}`, input.failedAt),
    );
  }

  /** E-14 — consumers are waiting on a decision. Raised by `moderation`'s backlog sweep. */
  async moderationBacklog(input: ModerationBacklogAlertInput): Promise<void> {
    await this.toEveryAdmin(
      TemplateId.MODERATION_BACKLOG_ALERT,
      {
        pendingCount: input.pendingCount,
        overdueCount: input.overdueCount,
        thresholdHours: input.thresholdHours,
        oldestPendingAt: input.oldestPendingAt,
        queueUrl: this.adminUrl('/admin/moderation'),
      },
      this.bucketedKey('moderation-backlog', new Date()),
    );
  }

  /** E-14 — generations are failing above the 4% line. */
  async generationFailureRate(input: GenerationFailureAlertInput): Promise<void> {
    this.metrics.gauge(METRICS.TRYON_FAILED, input.failureRatePercent, {
      errorCode: input.topFailureReason ?? 'UNKNOWN',
    });

    await this.toEveryAdmin(
      TemplateId.GENERATION_FAILURE_RATE_ALERT,
      {
        windowMinutes: input.windowMinutes,
        windowStartedAt: input.windowStartedAt,
        totalGenerations: input.totalGenerations,
        failedGenerations: input.failedGenerations,
        failureRatePercent: input.failureRatePercent,
        thresholdPercent: input.thresholdPercent,
        topFailureReason: input.topFailureReason,
        analyticsUrl: this.adminUrl('/admin/analytics/generation-health'),
      },
      this.bucketedKey('generation-failure-rate', new Date()),
    );
  }

  /**
   * E-14 — repeated authentication failures concentrated on one route.
   *
   * Metered and logged, not emailed. See the class comment: the registry has no
   * operator template for this condition and `@library/notifications` is outside this
   * module. The signal is not lost — it is on the metric an operator's dashboard
   * already reads and in the structured log — but it does not reach an inbox.
   */
  authenticationAnomaly(input: AuthenticationAnomalyAlertInput): void {
    this.metrics.gauge(METRICS.AUTH_DENIED, input.failures, { route: input.route });

    this.logger.warn(
      [
        'E-14 authentication anomaly',
        `route=${input.route}`,
        `failures=${input.failures}`,
        `distinctIps=${input.distinctIps}`,
        `distinctAccounts=${input.distinctAccounts}`,
        `windowMinutes=${input.windowMinutes}`,
        'delivery=metric+log — no operator template in @library/notifications',
      ].join(' · '),
    );
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Queues one email per active admin.
   *
   * One row each rather than one row with several recipients: a bounced address must
   * not stop the other operators hearing about a hard stop, and `notifications_outbox`
   * holds a single recipient by design (§4.32).
   *
   * The address is **not** written to the row — `recipientUserId` is, and the processor
   * resolves it at delivery time (E-12).
   */
  private async toEveryAdmin<K extends OperatorAlertTemplate>(
    template: K,
    props: TemplatePropsMap[K],
    dedupeKey: string,
  ): Promise<void> {
    const admins = await this.users.find({
      where: { role: Role.ADMIN, status: UserStatus.ACTIVE },
      select: { id: true, locale: true },
    });

    if (admins.length === 0) {
      this.logger.error(
        `An E-14 alert (${String(template)}) had nobody to go to — there is no active admin ` +
          'account. The condition is real; the notification is not deliverable.',
      );
      return;
    }

    for (const admin of admins) {
      const result = await this.outbox.enqueue({
        template,
        props,
        channel: NotificationChannel.EMAIL,
        recipientUserId: admin.id,
        locale: admin.locale,
        dedupeKey: `${dedupeKey}:${admin.id}`,
      });

      if (result.deduplicated) {
        this.logger.debug(`E-14 alert ${String(template)} was already queued for this operator.`);
      }
    }
  }

  /**
   * A key that changes once per {@link ALERT_DEDUPE_WINDOW_MS}.
   *
   * Bucketed rather than "time since the last one", so two processes cannot both decide
   * they are first — the bucket is a function of the clock, not of state.
   */
  private bucketedKey(prefix: string, at: Date): string {
    return `${prefix}:${Math.floor(at.getTime() / ALERT_DEDUPE_WINDOW_MS)}`;
  }

  /** `getOrThrow` because §7 marks `APP_WEB_URL` required — a link with no host is not a link. */
  private adminUrl(path: string): string {
    return `${this.config.getOrThrow<string>('APP_WEB_URL').replace(/\/+$/, '')}${path}`;
  }
}
