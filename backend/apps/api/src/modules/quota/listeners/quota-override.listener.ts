import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { SettingsService } from '@api/modules/settings';
import {
  USER_EVENTS,
  type UserQuotaOverrideChangedEvent,
} from '@api/modules/users/constants/user-events.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { QUOTA_EVENTS, type QuotaOverrideGrantedEvent } from '../events/quota.events';
import { QuotaService } from '../services/quota.service';

/**
 * PRD A-18 — a per-consumer quota override takes effect **immediately**, not at the
 * next period boundary.
 *
 * ### The seam this fills
 *
 * `modules/users` owns `consumer_profiles` and writes `monthlyQuotaOverride`, then
 * emits `user.quota_override_changed` with `{ from, to }`. It deliberately does not
 * touch `quota_ledger` — §4.33 gives that table to this module, and
 * `admin-consumers.service.ts` says so in as many words: *"the arithmetic that turns
 * an override into an actual allowance … belongs to `QuotaModule` and its append-only
 * ledger. Until then a mid-period raise takes effect at the next period boundary."*
 * This listener is what closes that gap.
 *
 * ### Why a raise is applied and a reduction is not
 *
 * §4.26: "Raising an override mid-period appends an `OVERRIDE_GRANT` for the
 * difference — it never rewrites the earlier row." The doc describes raises, and the
 * asymmetry is the right one for a consumer-facing allowance. She has been shown "11
 * left this month" on a persistent counter (C-5); appending a negative row would take
 * generations she has already been promised, mid-session, with no explanation the UI
 * could give her. A *lowered* override is a decision about next month, and that is
 * when it lands — the next period's lazy `MONTHLY_GRANT` reads the profile and grants
 * the new, smaller number.
 *
 * (The platform budget is the opposite case and is handled the opposite way — see
 * `BudgetService.reconcileMonthlyGrant`. A cost ceiling an admin lowers at 3pm is
 * meant to bind at 3pm.)
 *
 * ### Why the listener converges rather than adding `to - from`
 *
 * It calls `raiseEntitlementTo(target)`, which reads the grant rows that already exist
 * and appends only the shortfall. Adding the event's difference blindly would
 * double-grant if the event were replayed, and would grant the wrong amount if the
 * period's lazy `MONTHLY_GRANT` had not run yet — because `users` writes the profile
 * *before* it emits, so a grant materialised in between is already at the new value.
 * Converging on a target is correct in all three cases and needs no coordination.
 */
@Injectable()
export class QuotaOverrideListener {
  private readonly logger = new Logger(QuotaOverrideListener.name);

  constructor(
    private readonly quota: QuotaService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent(USER_EVENTS.QUOTA_OVERRIDE_CHANGED)
  async onQuotaOverrideChanged(event: UserQuotaOverrideChangedEvent): Promise<void> {
    const period = this.quota.periodFor(event.occurredAt);

    const defaultMonthly = await this.settings.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY);
    const from = event.from ?? defaultMonthly;
    const target = event.to ?? defaultMonthly;

    if (target <= from) {
      // A reduction, or no change. It lands at the next boundary; see the class note.
      this.logger.debug(
        `Quota override for a consumer moved to ${target} from ${from}; it applies from the next period.`,
      );
      return;
    }

    const granted = await this.quota.raiseEntitlementTo(
      event.userId,
      period,
      target,
      event.actorId,
      'Mid-period quota override (A-18).',
    );

    if (granted <= 0) {
      return;
    }

    const payload: QuotaOverrideGrantedEvent = {
      userId: event.userId,
      actorId: event.actorId,
      period,
      granted,
      entitlement: target,
      occurredAt: new Date(),
    };
    this.events.emit(QUOTA_EVENTS.QUOTA_OVERRIDE_GRANTED, payload);
  }
}
