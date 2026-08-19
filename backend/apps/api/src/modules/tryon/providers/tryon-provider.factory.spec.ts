import { OpenAiImageQuality, TryOnDriverName } from '@api/config/env.validation';
import type { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS, type SettingsKey } from '@api/shared/constants/settings-keys.constant';

import { TEST_ENV } from '../../../../test/setup/test-env';
import { TryOnConfig } from '../config/tryon.config';
import { fakeConfigService } from '../testing/tryon-harness';

import { GeminiTryOnProvider } from './gemini-tryon.provider';
import { HttpTryOnProvider } from './http-tryon.provider';
import { MockTryOnProvider } from './mock-tryon.provider';
import { OpenAiTryOnProvider } from './openai-tryon.provider';
import { createTryOnProvider } from './tryon-provider.factory';
import { TryOnProviderResolver } from './tryon-provider.resolver';

describe('the try-on driver decision (PRD B-1, §7, A-33)', () => {
  function configFor(overrides: Record<string, string | number> = {}): TryOnConfig {
    return new TryOnConfig(
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
        ...overrides,
      }),
    );
  }

  function fakeSettings(values: Partial<Record<SettingsKey, string>> = {}): SettingsService {
    return {
      getString: (key: SettingsKey): Promise<string | null> => Promise.resolve(values[key] ?? null),
    } as unknown as SettingsService;
  }

  const OPENAI_ENV = {
    OPENAI_BASE_URL: 'https://api.openai.invalid/v1',
    OPENAI_API_KEY: 'not-a-real-key',
    OPENAI_IMAGE_MODEL: 'gpt-image-2',
  };

  const GEMINI_ENV = {
    GEMINI_BASE_URL: 'https://generativelanguage.invalid/v1beta',
    GEMINI_API_KEY: 'not-a-real-key',
    GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',
  };

  describe('the boot decision — TRYON_DRIVER', () => {
    it('selects the mock driver for TRYON_DRIVER=mock', () => {
      expect(createTryOnProvider(configFor())).toBeInstanceOf(MockTryOnProvider);
    });

    it('selects the http driver only when explicitly asked, with credentials present', () => {
      const provider = createTryOnProvider(
        configFor({
          TRYON_DRIVER: 'http',
          TRYONCLOUD_BASE_URL: 'https://api.tryoncloud.invalid/v1',
          TRYONCLOUD_API_KEY: 'not-a-real-key',
        }),
      );

      expect(provider).toBeInstanceOf(HttpTryOnProvider);
      expect(provider.name).toBe('http');
    });

    it('selects the gemini driver only when explicitly asked, with credentials present', () => {
      const provider = createTryOnProvider(configFor({ TRYON_DRIVER: 'gemini', ...GEMINI_ENV }));

      expect(provider).toBeInstanceOf(GeminiTryOnProvider);
      expect(provider.name).toBe('gemini');
    });

    it('selects the openai driver only when explicitly asked, with credentials present', () => {
      const provider = createTryOnProvider(configFor({ TRYON_DRIVER: 'openai', ...OPENAI_ENV }));

      expect(provider).toBeInstanceOf(OpenAiTryOnProvider);
      expect(provider.name).toBe('openai');
    });

    it('falls back to the mock — never to a paid driver — for an unrecognised name', () => {
      expect(createTryOnProvider(configFor({ TRYON_DRIVER: 'somethingelse' }))).toBeInstanceOf(
        MockTryOnProvider,
      );
    });
  });

  describe('credentials are keyed by driver, not by the boot selection', () => {
    it('hands each driver its own key and never another driver’s', async () => {
      const config = configFor({
        TRYON_DRIVER: 'gemini',
        ...GEMINI_ENV,
        ...OPENAI_ENV,
        GEMINI_API_KEY: 'gemini-key',
        OPENAI_API_KEY: 'openai-key',
        TRYONCLOUD_API_KEY: 'tryoncloud-key',
      });

      expect(config.readApiKey(TryOnDriverName.GEMINI)).toBe('gemini-key');
      expect(config.readApiKey(TryOnDriverName.OPENAI)).toBe('openai-key');
      expect(config.readApiKey(TryOnDriverName.HTTP)).toBe('tryoncloud-key');
      expect(config.readApiKey(TryOnDriverName.MOCK)).toBeNull();
    });

    it('reports a driver with no credentials as unusable, so the dropdown can disable it', () => {
      const config = configFor({ TRYON_DRIVER: 'mock', ...GEMINI_ENV });

      expect(config.isDriverUsable(TryOnDriverName.GEMINI)).toBe(true);
      expect(config.isDriverUsable(TryOnDriverName.OPENAI)).toBe(false);
      expect(config.isDriverUsable(TryOnDriverName.HTTP)).toBe(false);
      expect(config.isDriverUsable(TryOnDriverName.MOCK)).toBe(true);
      expect(config.configuredDrivers).toEqual([TryOnDriverName.MOCK, TryOnDriverName.GEMINI]);
    });

    it('treats an empty credential as absent rather than as a usable secret', () => {
      const config = configFor({ TRYON_DRIVER: 'mock', ...OPENAI_ENV, OPENAI_API_KEY: '' });

      expect(config.readApiKey(TryOnDriverName.OPENAI)).toBeNull();
      expect(config.isDriverUsable(TryOnDriverName.OPENAI)).toBe(false);
    });
  });

  describe('the live decision — TryOnProviderResolver (A-33)', () => {
    it('follows TRYON_DRIVER when no admin has set an override', async () => {
      const config = configFor({ TRYON_DRIVER: 'gemini', ...GEMINI_ENV });
      const resolver = new TryOnProviderResolver(config, fakeSettings());

      const resolved = await resolver.resolve();

      expect(resolved.driver).toBe(TryOnDriverName.GEMINI);
      expect(resolved.provider).toBeInstanceOf(GeminiTryOnProvider);
    });

    it('prefers the admin override over the environment default', async () => {
      const config = configFor({ TRYON_DRIVER: 'gemini', ...GEMINI_ENV, ...OPENAI_ENV });
      const resolver = new TryOnProviderResolver(
        config,
        fakeSettings({ [SETTINGS_KEYS.TRYON_DRIVER]: 'openai' }),
      );

      const resolved = await resolver.resolve();

      expect(resolved.driver).toBe(TryOnDriverName.OPENAI);
      expect(resolved.provider).toBeInstanceOf(OpenAiTryOnProvider);
    });

    it('resolves the selected driver even when it is unconfigured, so it fails loudly', async () => {
      const config = configFor({ TRYON_DRIVER: 'mock' });
      const resolver = new TryOnProviderResolver(
        config,
        fakeSettings({ [SETTINGS_KEYS.TRYON_DRIVER]: 'openai' }),
      );

      const resolved = await resolver.resolve();

      expect(resolved.driver).toBe(TryOnDriverName.OPENAI);
      expect(config.isDriverUsable(TryOnDriverName.OPENAI)).toBe(false);
    });

    it('degrades a value that names no driver at all to the boot driver', async () => {
      const config = configFor({ TRYON_DRIVER: 'mock' });
      const resolver = new TryOnProviderResolver(
        config,
        fakeSettings({ [SETTINGS_KEYS.TRYON_DRIVER]: 'not-a-driver' }),
      );

      expect((await resolver.resolve()).driver).toBe(TryOnDriverName.MOCK);
    });
  });

  describe('the environment every spec in this repository runs under', () => {
    it('pins TRYON_DRIVER to mock', () => {
      expect(TEST_ENV.TRYON_DRIVER).toBe(TryOnDriverName.MOCK);
    });

    it('supplies no upstream API key at all', () => {
      expect(TEST_ENV.TRYONCLOUD_API_KEY).toBeUndefined();
      expect(TEST_ENV.TRYONCLOUD_BASE_URL).toBeUndefined();
      expect(TEST_ENV.GEMINI_API_KEY).toBeUndefined();
      expect(TEST_ENV.GEMINI_BASE_URL).toBeUndefined();
      expect(TEST_ENV.OPENAI_API_KEY).toBeUndefined();
      expect(TEST_ENV.OPENAI_BASE_URL).toBeUndefined();
    });

    it('resolves to MockTryOnProvider when the factory is given that environment', () => {
      const provider = createTryOnProvider(new TryOnConfig(fakeConfigService({ ...TEST_ENV })));

      expect(provider).toBeInstanceOf(MockTryOnProvider);
      expect(provider.name).toBe('mock');
    });

    it('cannot bill anything even if a setting names a paid driver', async () => {
      const config = new TryOnConfig(fakeConfigService({ ...TEST_ENV }));
      const resolver = new TryOnProviderResolver(
        config,
        fakeSettings({ [SETTINGS_KEYS.TRYON_DRIVER]: 'openai' }),
      );

      const { provider } = await resolver.resolve();

      expect(config.isDriverUsable(TryOnDriverName.OPENAI)).toBe(false);
      await expect(
        provider.generate({
          garmentImage: Buffer.from('garment'),
          garmentImageMimeType: 'image/png',
          personImage: Buffer.from('person'),
          personImageMimeType: 'image/png',
          correlationId: 'spend-guard',
        }),
      ).rejects.toMatchObject({ errorCode: 'TRYON_PROVIDER_MISCONFIGURED' });
    });

    it('defaults the OpenAI quality dial to medium, never to the expensive tier', async () => {
      const config = configFor({ TRYON_DRIVER: 'mock', ...OPENAI_ENV });
      const resolver = new TryOnProviderResolver(
        config,
        fakeSettings({ [SETTINGS_KEYS.TRYON_OPENAI_QUALITY]: 'ludicrous' }),
      );

      const quality = await (
        resolver as unknown as { readOpenAiQuality: () => Promise<OpenAiImageQuality> }
      ).readOpenAiQuality();

      expect(quality).toBe(OpenAiImageQuality.MEDIUM);
    });
  });
});
