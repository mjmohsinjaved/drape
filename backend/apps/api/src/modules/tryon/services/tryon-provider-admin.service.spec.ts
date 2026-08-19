import type { ICurrentUser } from '@library/common';

import { OpenAiImageQuality, TryOnDriverName } from '@api/config/env.validation';
import type { SettingsService } from '@api/modules/settings';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS, type SettingsKey } from '@api/shared/constants/settings-keys.constant';

import { TryOnConfig } from '../config/tryon.config';
import { TryOnProviderResolver } from '../providers/tryon-provider.resolver';
import { fakeConfigService } from '../testing/tryon-harness';

import { TryOnProviderAdminService } from './tryon-provider-admin.service';

const ADMIN: ICurrentUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: 'ADMIN',
} as unknown as ICurrentUser;

const GEMINI_ENV = {
  GEMINI_BASE_URL: 'https://generativelanguage.invalid/v1beta',
  GEMINI_API_KEY: 'not-a-real-key',
  GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',
};

const OPENAI_ENV = {
  OPENAI_BASE_URL: 'https://api.openai.invalid/v1',
  OPENAI_API_KEY: 'not-a-real-key',
  OPENAI_IMAGE_MODEL: 'gpt-image-2',
};

describe('TryOnProviderAdminService (A-33)', () => {
  function fakeSettings(initial: Partial<Record<SettingsKey, string>> = {}): {
    service: SettingsService;
    writes: { key: SettingsKey; value: unknown; action: string }[];
  } {
    const values: Record<string, string | undefined> = { ...initial };
    const writes: { key: SettingsKey; value: unknown; action: string }[] = [];

    const service = {
      getString: (key: SettingsKey): Promise<string | null> => Promise.resolve(values[key] ?? null),
      setInternal: (
        key: SettingsKey,
        value: unknown,
        _actor: ICurrentUser,
        action: string,
      ): Promise<unknown> => {
        writes.push({ key, value, action });
        values[key] = String(value);
        return Promise.resolve({});
      },
    } as unknown as SettingsService;

    return { service, writes };
  }

  interface Subject {
    config: TryOnConfig;
    settings: ReturnType<typeof fakeSettings>;
    service: TryOnProviderAdminService;
  }

  function build(
    env: Record<string, string | number>,
    initial: Partial<Record<SettingsKey, string>> = {},
  ): Subject {
    const config = new TryOnConfig(
      fakeConfigService({
        TRYON_DRIVER: 'mock',
        TRYON_API_VERSION: 'test-0000-00-00',
        TRYON_TIMEOUT_MS: 1_000,
        TRYON_MAX_ATTEMPTS: 3,
        TRYON_BACKOFF_BASE_MS: 0,
        TRYON_TEST_RENDER_CONCURRENCY: 1,
        TRYON_MOCK_LATENCY_MS: 0,
        TRYON_MOCK_FAILURE_RATE: 0,
        TRYON_RATE_PER_HOUR: 20,
        TRYON_RATE_PER_IP_HOUR: 40,
        ...env,
      }),
    );
    const settings = fakeSettings(initial);
    const resolver = new TryOnProviderResolver(config, settings.service);

    return {
      config,
      settings,
      service: new TryOnProviderAdminService(config, settings.service, resolver),
    };
  }

  describe('list()', () => {
    it('offers the three real drivers and omits the mock', async () => {
      const { service } = build({ TRYON_DRIVER: 'gemini', ...GEMINI_ENV });

      const state = await service.list();

      expect(state.providers.map((option) => option.driver)).toEqual([
        TryOnDriverName.HTTP,
        TryOnDriverName.GEMINI,
        TryOnDriverName.OPENAI,
      ]);
      expect(state.providers.every((option) => option.selectable)).toBe(true);

      const byDriver = new Map(state.providers.map((option) => [option.driver, option]));
      expect(byDriver.get(TryOnDriverName.GEMINI)?.configured).toBe(true);
      expect(byDriver.get(TryOnDriverName.OPENAI)?.configured).toBe(false);
      expect(byDriver.get(TryOnDriverName.HTTP)?.configured).toBe(false);
    });

    it('lists the mock as a read-only row when it is what is actually running', async () => {
      const { service } = build({ TRYON_DRIVER: 'mock', ...GEMINI_ENV });

      const state = await service.list();
      const mock = state.providers.find((option) => option.driver === TryOnDriverName.MOCK);

      expect(state.active).toBe(TryOnDriverName.MOCK);
      expect(mock).toBeDefined();
      expect(mock?.active).toBe(true);
      expect(mock?.selectable).toBe(false);
    });

    it('says when the live driver is the environment default rather than an override', async () => {
      const { service } = build({ TRYON_DRIVER: 'gemini', ...GEMINI_ENV });

      const state = await service.list();

      expect(state.active).toBe(TryOnDriverName.GEMINI);
      expect(state.followingEnvironment).toBe(true);
      expect(
        state.providers.find((option) => option.driver === TryOnDriverName.GEMINI)?.bootDefault,
      ).toBe(true);
    });

    it('says when the live driver comes from an admin override', async () => {
      const { service } = build(
        { TRYON_DRIVER: 'mock', ...OPENAI_ENV },
        {
          [SETTINGS_KEYS.TRYON_DRIVER]: 'openai',
        },
      );

      const state = await service.list();

      expect(state.active).toBe(TryOnDriverName.OPENAI);
      expect(state.followingEnvironment).toBe(false);
    });

    it('marks only the mock as free, so the console can warn before a billable switch', async () => {
      const { service } = build({});

      const state = await service.list();

      expect(
        state.providers.filter((option) => option.billable).map((option) => option.driver),
      ).toEqual([TryOnDriverName.HTTP, TryOnDriverName.GEMINI, TryOnDriverName.OPENAI]);
    });

    it('reports the shipped quality default rather than the expensive tier', async () => {
      const { service } = build({});

      expect((await service.list()).quality).toBe(OpenAiImageQuality.MEDIUM);
    });
  });

  describe('select()', () => {
    it('switches the driver and audits it as TRYON_DRIVER_CHANGED', async () => {
      const { service, settings } = build({ ...OPENAI_ENV });

      const state = await service.select({ driver: TryOnDriverName.OPENAI }, ADMIN);

      expect(settings.writes).toEqual([
        {
          key: SETTINGS_KEYS.TRYON_DRIVER,
          value: TryOnDriverName.OPENAI,
          action: AUDIT_ACTIONS.TRYON_DRIVER_CHANGED,
        },
      ]);
      expect(state.active).toBe(TryOnDriverName.OPENAI);
      expect(state.followingEnvironment).toBe(false);
    });

    it('refuses a driver with no credentials, and writes nothing', async () => {
      const { service, settings } = build({ ...GEMINI_ENV });

      await expect(service.select({ driver: TryOnDriverName.OPENAI }, ADMIN)).rejects.toMatchObject(
        { errorCode: 'SETTINGS_VALUE_INVALID' },
      );
      expect(settings.writes).toEqual([]);
    });

    it('writes the quality dial before the driver', async () => {
      const { service, settings } = build({ ...OPENAI_ENV });

      await service.select(
        { driver: TryOnDriverName.OPENAI, quality: OpenAiImageQuality.LOW },
        ADMIN,
      );

      expect(settings.writes.map((write) => write.key)).toEqual([
        SETTINGS_KEYS.TRYON_OPENAI_QUALITY,
        SETTINGS_KEYS.TRYON_DRIVER,
      ]);
      expect(settings.writes[0]?.value).toBe(OpenAiImageQuality.LOW);
    });

    it('leaves the quality dial alone when the request does not carry one', async () => {
      const { service, settings } = build({ ...GEMINI_ENV });

      await service.select({ driver: TryOnDriverName.GEMINI }, ADMIN);

      expect(settings.writes.map((write) => write.key)).toEqual([SETTINGS_KEYS.TRYON_DRIVER]);
    });

    it('refuses the mock — it is not a console-selectable option', async () => {
      const { service, settings } = build(
        { ...OPENAI_ENV },
        {
          [SETTINGS_KEYS.TRYON_DRIVER]: 'openai',
        },
      );

      await expect(service.select({ driver: TryOnDriverName.MOCK }, ADMIN)).rejects.toMatchObject({
        errorCode: 'SETTINGS_VALUE_INVALID',
      });
      expect(settings.writes).toEqual([]);
    });

    it('refuses the mock before checking credentials, since it needs none', async () => {
      const { service } = build({});

      await expect(service.select({ driver: TryOnDriverName.MOCK }, ADMIN)).rejects.toMatchObject({
        errorCode: 'SETTINGS_VALUE_INVALID',
      });
    });
  });
});
