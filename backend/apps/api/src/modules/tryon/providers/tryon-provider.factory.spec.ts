import { TryOnDriverName } from '@api/config/env.validation';

import { TEST_ENV } from '../../../../test/setup/test-env';
import { TryOnConfig } from '../config/tryon.config';
import { fakeConfigService } from '../testing/tryon-harness';

import { HttpTryOnProvider } from './http-tryon.provider';
import { MockTryOnProvider } from './mock-tryon.provider';
import { createTryOnProvider } from './tryon-provider.factory';

/**
 * **The test that keeps CI from spending the upstream budget.**
 *
 * The TryOnCloud account holds a total of **ten images**, permanently. There is no
 * quota that refills, no sandbox tier and no way to un-spend one. A single CI run that
 * reached the http driver would burn a meaningful fraction of the project's entire
 * upstream allowance, and nobody would notice until the eleventh generation failed.
 *
 * So this file asserts three things, in increasing order of paranoia:
 *
 *  1. the factory maps `mock` → `MockTryOnProvider` and `http` → `HttpTryOnProvider`;
 *  2. **the environment the whole suite runs under selects the mock** — not a fixture
 *     the test wrote for itself, but `TEST_ENV` from `apps/api/test/setup/test-env.ts`,
 *     the file `jest.setup.ts` applies to every spec in the repository;
 *  3. an unrecognised driver name falls back to the mock rather than guessing at the
 *     expensive option.
 */
describe('createTryOnProvider — the driver decision (PRD B-1, §7)', () => {
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

  it('falls back to the mock — never to http — for an unrecognised driver name', () => {
    // `validateEnv()` rejects this before the container is built, so the branch is
    // unreachable in practice. It exists so that it stays unreachable in the cheap
    // direction if it ever is not.
    expect(createTryOnProvider(configFor({ TRYON_DRIVER: 'somethingelse' }))).toBeInstanceOf(
      MockTryOnProvider,
    );
  });

  describe('the environment every spec in this repository runs under', () => {
    it('pins TRYON_DRIVER to mock', () => {
      expect(TEST_ENV.TRYON_DRIVER).toBe(TryOnDriverName.MOCK);
    });

    it('supplies no TryOnCloud API key at all', () => {
      // Belt and braces: even a test that somehow flipped the driver to `http` would
      // fail loudly on a missing credential rather than billing the account.
      expect(TEST_ENV.TRYONCLOUD_API_KEY).toBeUndefined();
      expect(TEST_ENV.TRYONCLOUD_BASE_URL).toBeUndefined();
    });

    it('resolves to MockTryOnProvider when the factory is given that environment', () => {
      const provider = createTryOnProvider(new TryOnConfig(fakeConfigService({ ...TEST_ENV })));

      expect(provider).toBeInstanceOf(MockTryOnProvider);
      expect(provider.name).toBe('mock');
    });
  });
});
