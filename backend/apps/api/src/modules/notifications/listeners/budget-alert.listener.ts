import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { QUOTA_EVENTS, type BudgetThresholdEvent } from '@api/modules/quota/events/quota.events';
import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { AlertingService } from '../services/alerting.service';

/**
 * **E-14 / A-29 — the two budget thresholds reach an operator.**
 *
 * `BudgetService` emits `budget.warning_reached` and `budget.exhausted` **only on the
 * charge that crossed the line** (`crossedThreshold()`), after the transaction has
 * committed. This turns each of those into an alert and does nothing else — no
 * decision about the budget is made here, and none can be: the events are records of a
 * crossing that has already happened.
 *
 * ### Why a listener rather than `quota` calling `AlertingService`
 *
 * `quota` must not know that alerting exists. Its module comment lists exactly three
 * consumers of `BudgetService` — `tryon`, `users` and `analytics` — and adding a
 * notifications dependency to the module that decides whether a generation may proceed
 * would put an email transport in the dependency graph of the try-on guard chain. The
 * event is the seam, and the edge runs one way: from here.
 *
 * ### Errors stop here
 *
 * `EventEmitterModule` runs with `ignoreErrors: false`, so a rejection escaping an
 * async listener is an unhandled rejection in the process that just served a
 * successful generation. An alert that cannot be queued is logged at `error` — itself
 * an operator signal — and dropped. The ledger position is correct either way.
 */
@Injectable()
export class BudgetAlertListener {
  private readonly logger = new Logger(BudgetAlertListener.name);

  constructor(
    private readonly alerts: AlertingService,
    private readonly settings: SettingsService,
  ) {}

  /** A-29 soft warning → `BUDGET_WARNING_80`. */
  @OnEvent(QUOTA_EVENTS.BUDGET_WARNING_REACHED, { async: true })
  async onBudgetWarning(event: BudgetThresholdEvent): Promise<void> {
    await this.raise('warning', event, async () =>
      this.alerts.budgetWarning({
        period: event.period,
        used: event.used,
        limit: event.limit,
        percentUsed: event.percentUsed,
        warnPercent: await this.warnPercent(event),
        resetsAt: event.resetsAt,
      }),
    );
  }

  /** A-29 hard stop → `BUDGET_EXHAUSTED_ADMIN`. */
  @OnEvent(QUOTA_EVENTS.BUDGET_EXHAUSTED, { async: true })
  async onBudgetExhausted(event: BudgetThresholdEvent): Promise<void> {
    await this.raise('exhausted', event, async () =>
      this.alerts.budgetExhausted({
        period: event.period,
        used: event.used,
        limit: event.limit,
        percentUsed: event.percentUsed,
        warnPercent: await this.warnPercent(event),
        resetsAt: event.resetsAt,
        // A-29's "consumers who hit the wall" is a `usage_ledger` question owned by
        // `quota`. The event does not carry it and this module must not go and ask.
        affectedConsumers: 0,
      }),
    );
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async raise(
    which: string,
    event: BudgetThresholdEvent,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error: unknown) {
      this.logger.error(
        `The budget ${which} alert for ${event.period} could not be queued: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * The threshold the copy names.
   *
   * Read from the same setting the threshold itself is derived from
   * (`budget.warnThresholdPercent`, A-29) rather than from a literal that could drift
   * away from it. A settings read that fails must not lose the alert, so the observed
   * percentage stands in — it is at worst a rounded version of the same number.
   */
  private async warnPercent(event: BudgetThresholdEvent): Promise<number> {
    try {
      return await this.settings.getNumber(SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT);
    } catch {
      return Math.round(event.percentUsed);
    }
  }
}
