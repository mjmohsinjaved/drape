import { EventEmitter2 } from '@nestjs/event-emitter';

import { AppException, ErrorCode, Locale, Role, UserStatus } from '@library/common';
import type { ICurrentUser } from '@library/common';

import { SettingsValueType } from '@api/modules/settings/enums/settings-value-type.enum';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';
import {
  SETTINGS_KEYS,
  SETTINGS_REGISTRY,
  type SettingsKey,
} from '@api/shared/constants/settings-keys.constant';

import {
  createServiceUnderTest,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { Setting } from '../entities/setting.entity';

import { SettingsService } from './settings.service';

import type { UpdateSettingsDto } from '../dto/update-settings.dto';

const ADMIN: ICurrentUser = {
  id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
  role: Role.ADMIN,
  email: 'admin@example.com',
  name: 'Studio Admin',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  sessionId: '11112222-3333-4444-8555-666677778888',
  locale: Locale.EN,
};

/** A `settings` row exactly as the seeder writes it. */
function row(key: SettingsKey, value: unknown, id = key): Setting {
  const definition = SETTINGS_REGISTRY.find((entry) => entry.key === key);
  if (definition === undefined) {
    throw new Error(`${key} is not in the registry.`);
  }
  return Object.assign(new Setting(), {
    id,
    key,
    value,
    valueType: definition.valueType,
    description: definition.description,
    isPublic: definition.isPublic,
    updatedBy: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
  });
}

function change(key: string, value: unknown): UpdateSettingsDto {
  return { changes: [{ key, value }] };
}

interface Harness {
  service: SettingsService;
  settings: InMemoryRepository<Setting>;
  events: EventEmitter2;
  harness: TestHarness;
}

async function build(rows: readonly Setting[] = []): Promise<Harness> {
  const events = new EventEmitter2();
  jest.spyOn(events, 'emit');

  const { service, harness } = await createServiceUnderTest(SettingsService, {
    repositories: [{ entity: Setting, rows }],
    overrides: [{ token: EventEmitter2, value: events }],
  });

  return { service, harness, events, settings: harness.repository<Setting>(Setting) };
}

describe('SettingsService', () => {
  describe('registry-driven reads', () => {
    it('falls back to the registry default when no row exists yet', async () => {
      const { service, harness } = await build();

      await expect(service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY)).resolves.toBe(15);
      // Off by default since 2026-08 — verification no longer stands before the first try-on.
      await expect(
        service.getBoolean(SETTINGS_KEYS.QUOTA_REQUIRE_EMAIL_VERIFICATION),
      ).resolves.toBe(false);

      await harness.close();
    });

    it('prefers the stored row over the registry default', async () => {
      const { service, harness } = await build([row(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 25)]);

      await expect(service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY)).resolves.toBe(25);

      await harness.close();
    });

    it('ignores a stored value that no longer validates rather than crashing the read', async () => {
      // A hand-edited database must not be able to take the fitting room down.
      const { service, harness } = await build([
        row(SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS, 'not a number'),
      ]);

      await expect(service.getNumber(SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS)).resolves.toBe(2000);

      await harness.close();
    });

    it('refuses a getter that disagrees with the registry type', async () => {
      const { service, harness } = await build();

      await expect(service.getNumber(SETTINGS_KEYS.SHARING_ENABLED)).rejects.toThrow(
        /is BOOLEAN, not NUMBER/,
      );

      await harness.close();
    });

    it('derives both A-29 budget thresholds in one place', async () => {
      const { service, harness } = await build([
        row(SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS, 2000),
        row(SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT, 80),
      ]);

      await expect(service.getBudgetPolicy()).resolves.toEqual({
        monthlyGenerations: 2000,
        warnThresholdPercent: 80,
        warnAt: 1600,
        hardStopAt: 2000,
      });

      await harness.close();
    });

    it('returns every registered key from findAll(), in registry order', async () => {
      const { service, harness } = await build();

      const all = await service.findAll();

      expect(all.map((setting) => setting.key)).toEqual(
        SETTINGS_REGISTRY.map((definition) => definition.key),
      );
      // The flags come from the registry, never from the row (§4.28).
      expect(
        all.every((setting, index) => setting.isPublic === SETTINGS_REGISTRY[index].isPublic),
      ).toBe(true);

      await harness.close();
    });
  });

  describe('registry-driven validation', () => {
    it('rejects an unknown key with SETTINGS_KEY_UNKNOWN, not a generic validation error', async () => {
      const { service, harness } = await build();

      await expect(
        service.update(change('quota.wishfulThinking', 99), ADMIN),
      ).rejects.toMatchObject({ errorCode: ErrorCode.SETTINGS_KEY_UNKNOWN });

      await harness.close();
    });

    const REJECTED: readonly { key: string; value: unknown; why: string }[] = [
      {
        key: SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY,
        value: 'fifteen',
        why: 'a string for a NUMBER key',
      },
      {
        key: SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY,
        value: 15.5,
        why: 'a fraction, not a whole number',
      },
      { key: SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, value: -1, why: 'a negative quota' },
      { key: SETTINGS_KEYS.SHARING_ENABLED, value: 'yes', why: 'a string for a BOOLEAN key' },
      { key: SETTINGS_KEYS.BRAND_PRIMARY_COLOR, value: '#abc', why: 'a three-digit hex colour' },
      {
        key: SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER,
        value: '0300 1234567',
        why: 'a non-E.164 number',
      },
      { key: SETTINGS_KEYS.BRAND_CONTACT_EMAIL, value: 'not-an-email', why: 'a malformed address' },
      {
        key: SETTINGS_KEYS.BRAND_LOGO_KEY,
        value: 'renders/u1/leak.png',
        why: 'a key outside brand/',
      },
      { key: SETTINGS_KEYS.SHORT_LINK_SLUG, value: 'Not A Slug', why: 'spaces and capitals' },
      {
        key: SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT,
        value: 100,
        why: 'a warning at the hard stop',
      },
      { key: SETTINGS_KEYS.BRAND_STORE_ADDRESSES, value: [{ label: 'Gulberg' }], why: 'no street' },
    ];

    it.each(REJECTED)('rejects $key — $why', async ({ key, value }) => {
      const { service, settings, harness } = await build();

      await expect(service.update(change(key, value), ADMIN)).rejects.toMatchObject({
        errorCode: ErrorCode.SETTINGS_VALUE_INVALID,
      });
      expect(settings.$rows).toHaveLength(0);

      await harness.close();
    });

    const NORMALISED: readonly { key: string; input: string; expected: string }[] = [
      { key: SETTINGS_KEYS.BRAND_PRIMARY_COLOR, input: '#71202f', expected: '#71202F' },
      {
        key: SETTINGS_KEYS.BRAND_INSTAGRAM_HANDLE,
        input: '@drape.studio',
        expected: 'drape.studio',
      },
      {
        key: SETTINGS_KEYS.BRAND_INSTAGRAM_HANDLE,
        input: 'https://instagram.com/drape.studio/',
        expected: 'drape.studio',
      },
      {
        key: SETTINGS_KEYS.BRAND_CONTACT_EMAIL,
        input: '  Hello@Example.COM ',
        expected: 'hello@example.com',
      },
    ];

    it.each(NORMALISED)(
      'normalises $key from $input to $expected',
      async ({ key, input, expected }) => {
        const { service, harness } = await build();

        const [updated] = await service.update(change(key, input), ADMIN);

        expect(updated.value).toBe(expected);

        await harness.close();
      },
    );

    it('clears an optional A-27 key but refuses to clear one with a default', async () => {
      const { service, harness } = await build();

      const [cleared] = await service.update(
        change(SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER, null),
        ADMIN,
      );
      expect(cleared.value).toBeNull();

      await expect(service.update(change(SETTINGS_KEYS.BRAND_NAME, null), ADMIN)).rejects.toThrow(
        AppException,
      );

      await harness.close();
    });

    it('applies nothing when any key in the batch is rejected', async () => {
      const { service, settings, harness } = await build();

      await expect(
        service.update(
          {
            changes: [
              { key: SETTINGS_KEYS.SHARING_ENABLED, value: false },
              { key: SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, value: -5 },
            ],
          },
          ADMIN,
        ),
      ).rejects.toThrow(AppException);

      expect(settings.$rows).toHaveLength(0);
      await expect(service.getBoolean(SETTINGS_KEYS.SHARING_ENABLED)).resolves.toBe(true);

      await harness.close();
    });

    it('rejects the same key twice in one batch', async () => {
      const { service, harness } = await build();

      await expect(
        service.update(
          {
            changes: [
              { key: SETTINGS_KEYS.SHARING_ENABLED, value: false },
              { key: SETTINGS_KEYS.SHARING_ENABLED, value: true },
            ],
          },
          ADMIN,
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.SETTINGS_VALUE_INVALID });

      await harness.close();
    });
  });

  describe('the cache', () => {
    it('reads the database once, however many getters are called', async () => {
      const { service, settings, harness } = await build([
        row(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 25),
      ]);

      // The W3–W7 hot path: this must not be one query per call.
      for (let call = 0; call < 20; call += 1) {
        await service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY);
        await service.getBoolean(SETTINGS_KEYS.SHARING_ENABLED);
      }

      expect(settings.find).toHaveBeenCalledTimes(1);

      await harness.close();
    });

    it('shares one load between concurrent callers', async () => {
      const { service, settings, harness } = await build();

      await Promise.all([
        service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY),
        service.getNumber(SETTINGS_KEYS.PHOTOS_MAX_PER_CONSUMER),
        service.getBoolean(SETTINGS_KEYS.ENQUIRIES_ENABLED),
      ]);

      expect(settings.find).toHaveBeenCalledTimes(1);

      await harness.close();
    });

    it('invalidates on write, so the next read sees the new value', async () => {
      const { service, harness } = await build([row(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 15)]);

      await expect(service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY)).resolves.toBe(15);

      await service.update(change(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 30), ADMIN);

      await expect(service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY)).resolves.toBe(30);

      await harness.close();
    });

    it('does not memoise a failed load', async () => {
      const { service, settings, harness } = await build();

      jest.spyOn(settings, 'find').mockRejectedValueOnce(new Error('connection reset'));

      await expect(service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY)).rejects.toThrow(
        'connection reset',
      );
      // A transient failure must not turn into a permanently broken config read.
      await expect(service.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY)).resolves.toBe(15);

      await harness.close();
    });
  });

  describe('writes', () => {
    it('creates the row when the seeder has never run for that key', async () => {
      const { service, settings, harness } = await build();

      await service.update(change(SETTINGS_KEYS.ENQUIRIES_ENABLED, false), ADMIN);

      const stored = settings.$rows.find((entry) => entry.key === SETTINGS_KEYS.ENQUIRIES_ENABLED);
      expect(stored).toMatchObject({
        value: false,
        valueType: SettingsValueType.BOOLEAN,
        isPublic: true,
        updatedBy: ADMIN.id,
      });

      await harness.close();
    });

    it('re-syncs valueType, description and isPublic from the registry on every write', async () => {
      // A drifted `isPublic` column would silently widen GET /settings/brand.
      const drifted = row(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 15);
      drifted.isPublic = true;
      drifted.description = 'tampered';

      const { service, settings, harness } = await build([drifted]);

      await service.update(change(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 20), ADMIN);

      const stored = settings.$rows[0];
      expect(stored.isPublic).toBe(false);
      expect(stored.description).toBe('Default monthly generation quota per consumer.');

      await harness.close();
    });

    it('audits a settings change with the registry-specific action', async () => {
      const { service, events, harness } = await build();

      await service.update(change(SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS, 3000), ADMIN);
      await service.update(change(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 20), ADMIN);
      await service.update(change(SETTINGS_KEYS.SHARING_ENABLED, false), ADMIN);

      const actions = jest
        .mocked(events.emit)
        .mock.calls.map(([, event]) => (event as { input: { action: string } }).input.action);

      expect(actions).toEqual([
        AUDIT_ACTIONS.BUDGET_LIMIT_CHANGED,
        AUDIT_ACTIONS.QUOTA_DEFAULT_CHANGED,
        AUDIT_ACTIONS.SETTING_UPDATED,
      ]);

      await harness.close();
    });

    it('puts the before/after diff under `settingKey`, which the redactor keeps', async () => {
      const { service, events, harness } = await build([
        row(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 15),
      ]);

      await service.update(change(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY, 20), ADMIN);

      const [, event] = jest.mocked(events.emit).mock.calls[0];
      expect((event as { input: { metadata: unknown } }).input.metadata).toEqual({
        settingKey: SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY,
        previousValue: 15,
        newValue: 20,
      });

      await harness.close();
    });
  });
});
