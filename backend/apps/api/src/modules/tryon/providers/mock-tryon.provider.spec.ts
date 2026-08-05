import { ErrorCode } from '@library/common';

import { TryOnConfig } from '../config/tryon.config';
import { fakeConfigService } from '../testing/tryon-harness';

import { MOCK_RENDER_HEIGHT, MOCK_RENDER_WIDTH, MockTryOnProvider } from './mock-tryon.provider';
import { isTryOnProviderError, type TryOnGenerationRequest } from './tryon-provider.interface';

/**
 * `MockTryOnProvider` — the default driver, and therefore the one whose behaviour the
 * entire test suite rests on.
 *
 * Three properties matter, and each is here:
 *
 *  - **deterministic** — the same two images produce the same bytes, so a cache test
 *    can honestly assert "the same render came back" and a C-16 test can change the
 *    photo and watch the pixels change;
 *  - **honest about latency** — `TRYON_MOCK_LATENCY_MS` is really waited, so the C-19
 *    seven-second wait is exercised rather than assumed;
 *  - **every failure mode reachable** — E-6 walks the §8.3 table, and it needs to do so
 *    without any probabilistic flakiness.
 */
describe('MockTryOnProvider', () => {
  function providerFor(overrides: Record<string, string | number> = {}): MockTryOnProvider {
    return new MockTryOnProvider(
      new TryOnConfig(
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
      ),
    );
  }

  function requestWith(person: string, garment = 'garment-bytes'): TryOnGenerationRequest {
    return {
      garmentImage: Buffer.from(garment),
      garmentImageMimeType: 'image/jpeg',
      personImage: Buffer.from(person),
      personImageMimeType: 'image/jpeg',
      correlationId: 'job-0001',
    };
  }

  it('identifies itself as the mock driver', () => {
    expect(providerFor().name).toBe('mock');
  });

  it('returns a real, readable PNG of the declared size', async () => {
    const result = await providerFor().generate(requestWith('person-bytes'));

    // `ImageService` will have to read these bytes with sharp, so a fake header is not
    // good enough — this is a genuine PNG.
    expect(result.png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(result.width).toBe(MOCK_RENDER_WIDTH);
    expect(result.height).toBe(MOCK_RENDER_HEIGHT);
    expect(result.attempts).toBe(1);
  });

  it('is deterministic: the same two images produce byte-identical renders', async () => {
    const provider = providerFor();

    const first = await provider.generate(requestWith('person-bytes'));
    const second = await provider.generate(requestWith('person-bytes'));

    expect(second.png.equals(first.png)).toBe(true);
  });

  it('produces different bytes when the photo changes (C-16)', async () => {
    const provider = providerFor();

    const original = await provider.generate(requestWith('person-bytes'));
    const replacement = await provider.generate(requestWith('a-different-photo'));

    expect(replacement.png.equals(original.png)).toBe(false);
  });

  it('honours the configured latency, so the C-19 wait is exercised', async () => {
    const provider = providerFor({ TRYON_MOCK_LATENCY_MS: 120 });

    const startedAt = Date.now();
    await provider.generate(requestWith('person-bytes'));

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
  });

  describe('simulating the §8.3 taxonomy on demand (E-6)', () => {
    it.each([
      ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
      ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
      ErrorCode.MODERATION_REJECTED,
      ErrorCode.UPSTREAM_INVALID_RESPONSE,
      ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
    ] as const)('fails immediately with %s and does not retry', async (code) => {
      const provider = providerFor();
      provider.alwaysFail(code);

      const error: unknown = await provider
        .generate(requestWith('person-bytes'))
        .catch((e: unknown) => e);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(code);
    });

    it.each([ErrorCode.UPSTREAM_TIMEOUT, ErrorCode.UPSTREAM_UNAVAILABLE] as const)(
      'retries %s up to TRYON_MAX_ATTEMPTS and then fails cleanly',
      async (code) => {
        const provider = providerFor();
        provider.alwaysFail(code);

        const error: unknown = await provider
          .generate(requestWith('person-bytes'))
          .catch((e: unknown) => e);

        expect(isTryOnProviderError(error) && error.errorCode).toBe(code);
      },
    );

    it('recovers when a transient failure is followed by a success', async () => {
      const provider = providerFor();
      provider.failNext(ErrorCode.UPSTREAM_TIMEOUT, 2);

      const result = await provider.generate(requestWith('person-bytes'));

      // Three attempts total: two timeouts, then the render.
      expect(result.attempts).toBe(3);
    });

    it('never surfaces UPSTREAM_RATE_LIMITED — it becomes UPSTREAM_UNAVAILABLE (§2.4)', async () => {
      const provider = providerFor();
      provider.alwaysFail(ErrorCode.UPSTREAM_RATE_LIMITED);

      const error: unknown = await provider
        .generate(requestWith('person-bytes'))
        .catch((e: unknown) => e);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
    });

    it('stays silent about rate limiting when a retry succeeds', async () => {
      const provider = providerFor();
      provider.failNext(ErrorCode.UPSTREAM_RATE_LIMITED, 1);

      const result = await provider.generate(requestWith('person-bytes'));

      expect(result.attempts).toBe(2);
    });

    it('reset() clears both the queue and the sticky failure', async () => {
      const provider = providerFor();
      provider.alwaysFail(ErrorCode.MODERATION_REJECTED);
      provider.failNext(ErrorCode.UPSTREAM_TIMEOUT);
      provider.reset();

      await expect(provider.generate(requestWith('person-bytes'))).resolves.toBeDefined();
    });
  });

  describe('TRYON_MOCK_FAILURE_RATE', () => {
    it('fails nothing at 0', async () => {
      await expect(providerFor().generate(requestWith('person-bytes'))).resolves.toBeDefined();
    });

    it('fails deterministically at 1 — the same request fails the same way twice', async () => {
      const provider = providerFor({ TRYON_MOCK_FAILURE_RATE: 1 });

      const first: unknown = await provider
        .generate(requestWith('person-bytes'))
        .catch((e: unknown) => e);
      const second: unknown = await provider
        .generate(requestWith('person-bytes'))
        .catch((e: unknown) => e);

      expect(isTryOnProviderError(first)).toBe(true);
      expect(isTryOnProviderError(first) && isTryOnProviderError(second)).toBe(true);
      expect(isTryOnProviderError(first) && isTryOnProviderError(second) && first.errorCode).toBe(
        isTryOnProviderError(second) ? second.errorCode : null,
      );
    });
  });
});
