/**
 * PRD A-18 — "Per-consumer quota override", applied **mid-period**.
 *
 * `modules/users` writes `consumer_profiles.monthlyQuotaOverride` and emits
 * `user.quota_override_changed`. Until this listener existed, its own comment admitted
 * the consequence: *"a mid-period raise takes effect at the next period boundary."*
 * These tests are what says it no longer does.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';

import { type SettingsService } from '@api/modules/settings';
import { type UserQuotaOverrideChangedEvent } from '@api/modules/users/constants/user-events.constant';

import { createMock } from '../../../../test/fixtures';
import { QUOTA_EVENTS, type QuotaOverrideGrantedEvent } from '../events/quota.events';
import { type QuotaService } from '../services/quota.service';

import { QuotaOverrideListener } from './quota-override.listener';

const CONSUMER_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';
const ADMIN_ID = 'cccccccc-1111-4222-8333-444455556666';
const AUGUST = '2026-08';
const NOW = new Date('2026-08-15T12:00:00.000Z');

interface Harness {
  listener: QuotaOverrideListener;
  quota: jest.Mocked<QuotaService>;
  granted: QuotaOverrideGrantedEvent[];
}

function build(options: { defaultMonthly?: number; granted?: number } = {}): Harness {
  const quota = createMock<QuotaService>(['periodFor', 'raiseEntitlementTo']);
  quota.periodFor.mockReturnValue(AUGUST);
  quota.raiseEntitlementTo.mockResolvedValue(options.granted ?? 25);

  const settings = createMock<SettingsService>(['getNumber']);
  settings.getNumber.mockResolvedValue(options.defaultMonthly ?? 15);

  const events = new EventEmitter2();
  const granted: QuotaOverrideGrantedEvent[] = [];
  events.on(QUOTA_EVENTS.QUOTA_OVERRIDE_GRANTED, (payload: QuotaOverrideGrantedEvent) =>
    granted.push(payload),
  );

  return { listener: new QuotaOverrideListener(quota, settings, events), quota, granted };
}

function overrideChanged(from: number | null, to: number | null): UserQuotaOverrideChangedEvent {
  return { userId: CONSUMER_ID, actorId: ADMIN_ID, occurredAt: NOW, from, to };
}

describe('QuotaOverrideListener — a raise lands immediately (A-18)', () => {
  it('raises this period’s entitlement to the new override', async () => {
    const { listener, quota } = build();

    await listener.onQuotaOverrideChanged(overrideChanged(null, 40));

    // `null` means she was on the settings default of 15; the target is 40.
    expect(quota.raiseEntitlementTo).toHaveBeenCalledWith(
      CONSUMER_ID,
      AUGUST,
      40,
      ADMIN_ID,
      expect.stringContaining('A-18'),
    );
  });

  it('raises from an existing override to a larger one', async () => {
    const { listener, quota } = build();

    await listener.onQuotaOverrideChanged(overrideChanged(20, 45));

    expect(quota.raiseEntitlementTo).toHaveBeenCalledWith(
      CONSUMER_ID,
      AUGUST,
      45,
      ADMIN_ID,
      expect.any(String),
    );
  });

  it('announces the grant so notifications can tell her (E-14)', async () => {
    const { listener, granted } = build({ granted: 25 });

    await listener.onQuotaOverrideChanged(overrideChanged(null, 40));

    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({
      userId: CONSUMER_ID,
      actorId: ADMIN_ID,
      period: AUGUST,
      granted: 25,
      entitlement: 40,
    });
  });

  it('stays quiet when the entitlement already covered the new target', async () => {
    const { listener, granted } = build({ granted: 0 });

    await listener.onQuotaOverrideChanged(overrideChanged(null, 40));

    expect(granted).toHaveLength(0);
  });
});

describe('QuotaOverrideListener — a reduction waits for the boundary', () => {
  it('appends nothing when the override is lowered', async () => {
    // She has been shown a persistent counter (C-5). Taking generations back
    // mid-session, with no explanation the UI could give, is a promise broken — the
    // smaller number is a decision about next month and lands with next month's grant.
    const { listener, quota, granted } = build();

    await listener.onQuotaOverrideChanged(overrideChanged(40, 20));

    expect(quota.raiseEntitlementTo).not.toHaveBeenCalled();
    expect(granted).toHaveLength(0);
  });

  it('appends nothing when the override is cleared back to the default', async () => {
    const { listener, quota } = build({ defaultMonthly: 15 });

    await listener.onQuotaOverrideChanged(overrideChanged(40, null));

    expect(quota.raiseEntitlementTo).not.toHaveBeenCalled();
  });

  it('appends nothing when the value did not actually change', async () => {
    const { listener, quota } = build();

    await listener.onQuotaOverrideChanged(overrideChanged(40, 40));

    expect(quota.raiseEntitlementTo).not.toHaveBeenCalled();
  });

  it('treats clearing an override *below* the default as a raise', async () => {
    // She was capped at 5; clearing the override puts her back on the default of 15,
    // which is more than she had. That is a raise and applies at once.
    const { listener, quota } = build({ defaultMonthly: 15 });

    await listener.onQuotaOverrideChanged(overrideChanged(5, null));

    expect(quota.raiseEntitlementTo).toHaveBeenCalledWith(
      CONSUMER_ID,
      AUGUST,
      15,
      ADMIN_ID,
      expect.any(String),
    );
  });
});
