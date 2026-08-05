import { computeBackoffMs, type BackoffPolicy } from '@library/common';

import {
  NotificationTimeoutError,
  toNotificationError,
  type NotificationError,
} from '../exceptions/notification.exception';

/**
 * Timeout + bounded retry with exponential backoff (PRD E-11).
 *
 * Every external call in this library goes through `runWithRetry`. Nothing else starts a timer or
 * counts attempts.
 */
export interface RetryPolicy extends BackoffPolicy {
  /** Inclusive of the first try. Must be >= 1. */
  readonly maxAttempts: number;
  /** Per-attempt deadline. Must be >= 1. */
  readonly timeoutMs: number;
  /** 0–1. Proportion of the delay added at random. Required here: provider calls race. */
  readonly jitterRatio: number;
}

export interface AttemptContext {
  /** 1-based. */
  readonly attempt: number;
  /** Aborted the moment the attempt's deadline passes. */
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface AttemptFailure {
  readonly attempt: number;
  readonly error: NotificationError;
  readonly willRetry: boolean;
  readonly delayMs: number;
}

export interface RetryHooks {
  readonly onAttemptFailed?: (failure: AttemptFailure) => void;
}

export interface RetryResult<T> {
  readonly value: T;
  /** Attempts made, including the one that succeeded. */
  readonly attempts: number;
}

/** Resolves after `ms`. Returns immediately for a non-positive delay, so tests never wait. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Exponential backoff with jitter, capped — `@library/common`'s implementation.
 *
 * Re-exported rather than reimplemented: a {@link RetryPolicy} already satisfies
 * `BackoffPolicy`, and the schedule a retry loop waits on is not a notifications fact.
 */
export { computeBackoffMs } from '@library/common';

/**
 * Races `operation` against a deadline.
 *
 * The losing branch is neutralised on both sides: the timer is cleared when the work wins, and a
 * late rejection from abandoned work is swallowed rather than becoming an unhandled rejection
 * (PRD E-11).
 */
export async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NotificationTimeoutError(`No response within ${timeoutMs} ms.`));
    }, timeoutMs);
  });

  let work: Promise<T>;
  try {
    work = operation(controller.signal);
  } catch (error) {
    // A provider that throws synchronously must not escape the wrapper.
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    throw toNotificationError(error);
  }

  // An abandoned attempt must never surface as an unhandled rejection.
  void work.catch(() => undefined);

  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Runs `operation` under the policy and throws the last `NotificationError` when every attempt is
 * spent. A non-retryable failure stops immediately — retrying a rejected credential just burns time.
 */
export async function runWithRetry<T>(
  policy: RetryPolicy,
  operation: (context: AttemptContext) => Promise<T>,
  hooks: RetryHooks = {},
): Promise<RetryResult<T>> {
  const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));
  let lastError: NotificationError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await withTimeout(policy.timeoutMs, (signal) =>
        operation({ attempt, signal, timeoutMs: policy.timeoutMs }),
      );
      return { value, attempts: attempt };
    } catch (error) {
      lastError = toNotificationError(error);
      const isLastAttempt = attempt >= maxAttempts;
      const willRetry = !isLastAttempt && lastError.retryable;
      const delayMs = willRetry ? computeBackoffMs(policy, attempt) : 0;
      hooks.onAttemptFailed?.({ attempt, error: lastError, willRetry, delayMs });
      if (!willRetry) {
        break;
      }
      await sleep(delayMs);
    }
  }

  throw (
    lastError ??
    new NotificationTimeoutError('The send loop ended without an attempt. Check `maxAttempts`.')
  );
}
