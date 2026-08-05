/**
 * Exponential backoff — the one implementation.
 *
 * `base * 2 ** (attempt - 1)` was written out three times: once capped and jittered
 * (the notifications retry loop), once capped without jitter (the outbox drain) and
 * once **with no cap at all** (the try-on config), where the delay grew unbounded and a
 * run of failures could park a retry hours away. A backoff without a ceiling is not a
 * backoff, it is a leak, so the cap is part of the type here and cannot be forgotten by
 * the next caller.
 *
 * Jitter is optional because the two uses genuinely differ. A provider call races other
 * tenants' calls against the same upstream and wants its retries spread out; a
 * single-process cron drain has nobody to collide with and a deterministic delay is
 * easier to reason about and to test. Omitting `jitterRatio` is therefore a decision,
 * not an oversight — and it still cannot skip the cap.
 */
export interface BackoffPolicy {
  /** Delay before the first retry. A non-positive base means "do not wait at all". */
  readonly backoffBaseMs: number;
  /** Ceiling on the un-jittered delay. Required — this is the point of the helper. */
  readonly backoffMaxMs: number;
  /** 0–1. Proportion of the capped delay added at random. Omit for no jitter. */
  readonly jitterRatio?: number;
}

/**
 * The delay before retry number `attempt`. `attempt` is 1-based, so attempt 1 waits
 * `backoffBaseMs`, attempt 2 waits twice that, and every attempt is capped.
 *
 * `random` is injectable so a test can pin the jitter rather than assert a range.
 */
export function computeBackoffMs(
  policy: BackoffPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  if (policy.backoffBaseMs <= 0) {
    return 0;
  }
  const exponential = policy.backoffBaseMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, policy.backoffMaxMs);
  const jitter = capped * Math.max(0, policy.jitterRatio ?? 0) * random();
  return Math.round(capped + jitter);
}
