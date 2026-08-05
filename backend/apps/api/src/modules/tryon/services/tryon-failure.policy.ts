import { ErrorCode, getErrorCodeSpec } from '@library/common';

/**
 * **PRD §8.3, the failure taxonomy, as data.** E-6.
 *
 * Each row of the PRD table becomes one entry: the `ErrorCode` §2.4 assigns it, the
 * system behaviour the PRD prescribes, and whether the consumer is told anything at
 * all. Written as a table rather than as branches inside `TryOnService` for three
 * reasons:
 *
 *  - E-6 wants an integration test per branch, and a test can iterate a table;
 *  - "no charge, no retry, no quota consumed" is a claim about *every* failure, so it
 *    is worth being able to look down a column and see that no row says otherwise;
 *  - the consumer copy is **not** here. It comes from `ERROR_CODE_SPECS`, which takes
 *    the ✔︎ strings verbatim from PRD §8.3. Restating a message in this file would be
 *    a second place for it to drift, and §2.4 is explicit that these strings are fixed
 *    copy — translate them, do not rewrite them.
 */

/** What the system does about a failure, beyond telling the consumer. */
export interface FailureBehaviour {
  readonly errorCode: ErrorCode;
  /** `BACKOFF` is §8.3's "exponential backoff, max 3 attempts"; `NONE` fails at once. */
  readonly retry: 'BACKOFF' | 'NONE';
  /** A-15 — increments `garments.failureCount` and raises a catalog-health row. */
  readonly flagGarmentForReview: boolean;
  /** Writes a `moderation_items` row and blocks the photo pending review. */
  readonly queueModeration: boolean;
  /** A-29 / E-14 — an admin hears about it immediately. */
  readonly alertAdmin: boolean;
  /**
   * false for `UPSTREAM_RATE_LIMITED` alone: §2.4 says it is *never surfaced* — the job
   * stays `RUNNING` and the SSE stream stays open while it backs off.
   */
  readonly surfacedToConsumer: boolean;
}

function behaviour(
  errorCode: ErrorCode,
  overrides: Partial<Omit<FailureBehaviour, 'errorCode'>> = {},
): FailureBehaviour {
  return {
    errorCode,
    retry: 'NONE',
    flagGarmentForReview: false,
    queueModeration: false,
    alertAdmin: false,
    surfacedToConsumer: true,
    ...overrides,
  };
}

/**
 * The table. Every condition PRD §8.3 lists, plus the two §2.4 adds for malformed and
 * misconfigured upstreams.
 *
 * Note the column that is uniform: **not one row consumes quota or budget.** That is
 * not enforced here — it is enforced by `QuotaPort.commitGeneration()` being reachable
 * only from the `SUCCEEDED` branch of `TryOnService.run()` — but it is stated here so
 * that a future row cannot be added without someone reading the sentence.
 */
export const TRYON_FAILURE_POLICY: Readonly<Partial<Record<ErrorCode, FailureBehaviour>>> = {
  // "No garment detected" — flag garment for review, no charge, no retry.
  [ErrorCode.UPSTREAM_NO_GARMENT_DETECTED]: behaviour(ErrorCode.UPSTREAM_NO_GARMENT_DETECTED, {
    flagGarmentForReview: true,
  }),

  // "Unsupported or corrupt format" — caught at client validation wherever possible.
  [ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT]: behaviour(ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT),

  // "Moderation rejection" — neutral request for a different photo, no detail disclosed.
  [ErrorCode.MODERATION_REJECTED]: behaviour(ErrorCode.MODERATION_REJECTED, {
    queueModeration: true,
  }),

  // "Timeout or 5xx" — exponential backoff, max 3 attempts, then fail cleanly.
  [ErrorCode.UPSTREAM_TIMEOUT]: behaviour(ErrorCode.UPSTREAM_TIMEOUT, { retry: 'BACKOFF' }),
  [ErrorCode.UPSTREAM_UNAVAILABLE]: behaviour(ErrorCode.UPSTREAM_UNAVAILABLE, {
    retry: 'BACKOFF',
  }),

  // "Upstream rate limit" — silent; stays pending. Backoff and retry.
  [ErrorCode.UPSTREAM_RATE_LIMITED]: behaviour(ErrorCode.UPSTREAM_RATE_LIMITED, {
    retry: 'BACKOFF',
    surfacedToConsumer: false,
  }),

  // §2.4 — a malformed payload reads to the consumer as "trouble with this piece".
  [ErrorCode.UPSTREAM_INVALID_RESPONSE]: behaviour(ErrorCode.UPSTREAM_INVALID_RESPONSE, {
    flagGarmentForReview: true,
  }),

  // §2.4 — `TRYON_DRIVER=http` with no API key. Startup validation catches it first.
  [ErrorCode.TRYON_PROVIDER_MISCONFIGURED]: behaviour(ErrorCode.TRYON_PROVIDER_MISCONFIGURED, {
    alertAdmin: true,
  }),

  // "Personal quota exhausted" — offer enquiry as the next action. A guard-chain
  // refusal, so it never reaches a job; listed because §8.3 lists it.
  [ErrorCode.QUOTA_EXHAUSTED]: behaviour(ErrorCode.QUOTA_EXHAUSTED),

  // "System budget exhausted" — alert Admin immediately, capture interest.
  [ErrorCode.BUDGET_EXHAUSTED]: behaviour(ErrorCode.BUDGET_EXHAUSTED, { alertAdmin: true }),
};

/** Every code the taxonomy covers, in table order — the E-6 sweep. */
export const TRYON_FAILURE_CODES: readonly ErrorCode[] = Object.keys(TRYON_FAILURE_POLICY).filter(
  (code): code is ErrorCode => code in TRYON_FAILURE_POLICY,
);

/**
 * The behaviour for `code`.
 *
 * An unknown code is treated as a non-retryable, non-flagging failure that the
 * consumer is told about. That is the safe direction: it neither retries something the
 * taxonomy has not blessed nor silently swallows a failure she is waiting on.
 */
export function failureBehaviourFor(code: ErrorCode): FailureBehaviour {
  return TRYON_FAILURE_POLICY[code] ?? behaviour(code);
}

/**
 * The consumer-facing message for `code` — **from `ERROR_CODE_SPECS`, always**.
 *
 * There is no second copy of these strings anywhere in this module. §2.4 marks the
 * ✔︎ rows as verbatim from PRD §8.3 and a spec in `libs/common` asserts them character
 * for character; this function is how the try-on path inherits that guarantee.
 */
export function consumerMessageFor(code: ErrorCode): string {
  return getErrorCodeSpec(code).message;
}
