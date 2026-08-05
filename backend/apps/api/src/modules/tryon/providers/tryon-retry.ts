import { ErrorCode } from '@library/common';

import {
  TryOnProviderError,
  isTryOnProviderError,
  type TryOnProviderErrorCode,
} from './tryon-provider.interface';

/**
 * The §8.3 retry policy, as data.
 *
 * > "Timeout or 5xx — exponential backoff, max 3 attempts, then fail cleanly."
 * > "Upstream rate limit — silent; stays pending. Backoff and retry."
 *
 * Everything else fails on the first attempt. Retrying a garment the upstream could
 * not find in the image spends money to be told the same thing again, and retrying a
 * moderation rejection is worse than useless.
 */
export const RETRYABLE_UPSTREAM_CODES: readonly TryOnProviderErrorCode[] = [
  ErrorCode.UPSTREAM_TIMEOUT,
  ErrorCode.UPSTREAM_UNAVAILABLE,
  ErrorCode.UPSTREAM_RATE_LIMITED,
];

export function isRetryableUpstreamCode(code: TryOnProviderErrorCode): boolean {
  return RETRYABLE_UPSTREAM_CODES.includes(code);
}

/**
 * The code a job actually fails with once the attempts are spent.
 *
 * §2.4: `UPSTREAM_RATE_LIMITED` is *never surfaced* — the job stays `RUNNING` and the
 * SSE stream stays open while it backs off. "Only once attempts are exhausted does the
 * job fail as `UPSTREAM_UNAVAILABLE`." This function is that sentence.
 */
export function terminalCodeFor(code: TryOnProviderErrorCode): TryOnProviderErrorCode {
  return code === ErrorCode.UPSTREAM_RATE_LIMITED ? ErrorCode.UPSTREAM_UNAVAILABLE : code;
}

export interface RetryOptions {
  /** Total attempts, **not** retries after the first. `TRYON_MAX_ATTEMPTS`, 3 by default. */
  readonly maxAttempts: number;
  /** Milliseconds to wait before the attempt that follows `attempt` (1-based). */
  readonly backoffMsFor: (attempt: number) => number;
  /** Called before each wait, so the caller can emit `tryon.retried` and log. */
  readonly onRetry?: (attempt: number, error: TryOnProviderError, waitMs: number) => void;
  /** Injected so tests never really sleep. Defaults to `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The result of a bounded retry: the value plus how many attempts it cost. */
export interface RetryOutcome<T> {
  readonly value: T;
  readonly attempts: number;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs `attempt` with the §8.3 bounded, exponentially-backed-off retry policy — E-11.
 *
 * Guarantees the callers depend on:
 *
 *  - **it never rejects with an untyped error.** Anything the attempt throws that is
 *    not a `TryOnProviderError` is wrapped as `UPSTREAM_INVALID_RESPONSE`, because an
 *    unclassified throw from a provider is a provider defect and the consumer copy for
 *    it is already decided;
 *  - **`maxAttempts` is a ceiling on attempts, not on retries.** Three means three
 *    upstream calls, worst case;
 *  - **the terminal code is mapped once**, so a job that exhausted its retries on rate
 *    limiting fails as `UPSTREAM_UNAVAILABLE` and never as a code §2.4 says is never
 *    surfaced.
 */
export async function runWithRetry<T>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = Math.max(1, options.maxAttempts);

  let lastError: TryOnProviderError = new TryOnProviderError(
    ErrorCode.UPSTREAM_INVALID_RESPONSE,
    'The provider produced no result and no error.',
  );

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      return { value: await attempt(attemptNumber), attempts: attemptNumber };
    } catch (error: unknown) {
      lastError = isTryOnProviderError(error)
        ? error
        : new TryOnProviderError(
            ErrorCode.UPSTREAM_INVALID_RESPONSE,
            'The provider threw an unclassified error.',
            undefined,
            { cause: error },
          );

      const canRetry = isRetryableUpstreamCode(lastError.errorCode) && attemptNumber < maxAttempts;

      if (!canRetry) {
        break;
      }

      const waitMs = options.backoffMsFor(attemptNumber);
      options.onRetry?.(attemptNumber, lastError, waitMs);
      await sleep(waitMs);
    }
  }

  throw new TryOnProviderError(
    terminalCodeFor(lastError.errorCode),
    lastError.message,
    lastError.status,
    { cause: lastError },
  );
}
