import { ErrorCode } from '@library/common';

import { TryOnProviderError, isTryOnProviderError } from './tryon-provider.interface';
import {
  isRetryableUpstreamCode,
  RETRYABLE_UPSTREAM_CODES,
  runWithRetry,
  terminalCodeFor,
} from './tryon-retry';

import type { RetryOptions } from './tryon-retry';

/**
 * The §8.3 retry policy, on its own.
 *
 * > "Timeout or 5xx — exponential backoff, max 3 attempts, then fail cleanly."
 * > "Upstream rate limit — silent; stays pending. Backoff and retry."
 *
 * `maxAttempts` is a ceiling on **attempts**, not on retries after the first. Getting
 * that off by one means either two upstream calls where the PRD asks for three, or four
 * where it asks for three — and every one of them is a real charge against a
 * ten-image account.
 */
describe('runWithRetry — the §8.3 policy', () => {
  /** Never really sleeps; records what the policy asked to wait. */
  function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
    const waits: number[] = [];
    return {
      waits,
      sleep: async (ms: number): Promise<void> => {
        waits.push(ms);
      },
    };
  }

  const options = (maxAttempts: number, sleep: (ms: number) => Promise<void>): RetryOptions => ({
    maxAttempts,
    backoffMsFor: (attempt: number): number => 800 * 2 ** (attempt - 1),
    sleep,
  });

  it('classifies exactly the three retryable codes', () => {
    expect(RETRYABLE_UPSTREAM_CODES).toEqual([
      ErrorCode.UPSTREAM_TIMEOUT,
      ErrorCode.UPSTREAM_UNAVAILABLE,
      ErrorCode.UPSTREAM_RATE_LIMITED,
    ]);
    expect(isRetryableUpstreamCode(ErrorCode.UPSTREAM_NO_GARMENT_DETECTED)).toBe(false);
    expect(isRetryableUpstreamCode(ErrorCode.MODERATION_REJECTED)).toBe(false);
  });

  it('maps an exhausted rate limit to UPSTREAM_UNAVAILABLE and nothing else to anything', () => {
    // §2.4: UPSTREAM_RATE_LIMITED is never surfaced.
    expect(terminalCodeFor(ErrorCode.UPSTREAM_RATE_LIMITED)).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
    expect(terminalCodeFor(ErrorCode.UPSTREAM_TIMEOUT)).toBe(ErrorCode.UPSTREAM_TIMEOUT);
  });

  it('returns on the first attempt when nothing goes wrong', async () => {
    const { sleep, waits } = recordingSleep();

    const outcome = await runWithRetry(async () => 'render', options(3, sleep));

    expect(outcome).toEqual({ value: 'render', attempts: 1 });
    expect(waits).toEqual([]);
  });

  it('makes exactly three attempts for a retryable failure — not two, not four', async () => {
    const { sleep } = recordingSleep();
    const attempt = jest.fn(async () => {
      throw new TryOnProviderError(ErrorCode.UPSTREAM_TIMEOUT, 'timed out');
    });

    await expect(runWithRetry(attempt, options(3, sleep))).rejects.toThrow();

    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('backs off exponentially between attempts', async () => {
    const { sleep, waits } = recordingSleep();

    await expect(
      runWithRetry(
        async () => {
          throw new TryOnProviderError(ErrorCode.UPSTREAM_UNAVAILABLE, '503');
        },
        options(3, sleep),
      ),
    ).rejects.toThrow();

    // Two waits for three attempts, doubling.
    expect(waits).toEqual([800, 1_600]);
  });

  it('does not retry a code the taxonomy says not to retry', async () => {
    const { sleep, waits } = recordingSleep();
    const attempt = jest.fn(async () => {
      throw new TryOnProviderError(ErrorCode.UPSTREAM_NO_GARMENT_DETECTED, 'no garment');
    });

    await expect(runWithRetry(attempt, options(3, sleep))).rejects.toThrow();

    // Retrying a garment the upstream could not find spends money to be told the same
    // thing again.
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('reports the attempt count that succeeded, so the job row is honest', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;

    const outcome = await runWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new TryOnProviderError(ErrorCode.UPSTREAM_TIMEOUT, 'timed out');
        }
        return 'render';
      },
      options(3, sleep),
    );

    expect(outcome.attempts).toBe(3);
  });

  it('wraps an unclassified throw rather than letting it escape untyped', async () => {
    const { sleep } = recordingSleep();

    const error: unknown = await runWithRetry(
      async () => {
        throw new Error('something nobody classified');
      },
      options(3, sleep),
    ).catch((e: unknown) => e);

    // A provider that throws something the taxonomy does not name is a provider defect,
    // and the consumer copy for it is already decided.
    expect(isTryOnProviderError(error) && error.errorCode).toBe(
      ErrorCode.UPSTREAM_INVALID_RESPONSE,
    );
  });

  it('honours a maxAttempts of 1 as "no retries"', async () => {
    const { sleep } = recordingSleep();
    const attempt = jest.fn(async () => {
      throw new TryOnProviderError(ErrorCode.UPSTREAM_TIMEOUT, 'timed out');
    });

    await expect(runWithRetry(attempt, options(1, sleep))).rejects.toThrow();

    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
