import { ERROR_CODE_SPECS, ErrorCode } from '@library/common';

import {
  consumerMessageFor,
  failureBehaviourFor,
  TRYON_FAILURE_CODES,
  TRYON_FAILURE_POLICY,
} from './tryon-failure.policy';

/**
 * The §8.3 table, checked as a table.
 *
 * Two properties are worth asserting over the whole thing rather than row by row:
 * **no row retries something the PRD does not say to retry**, and **no row's consumer
 * copy is written here** — every message comes from `ERROR_CODE_SPECS`, which takes the
 * ✔︎ strings verbatim from the PRD. A second copy of a fixed string is a second place
 * for it to drift.
 */
describe('the §8.3 failure policy', () => {
  it('covers every condition PRD §8.3 lists, plus the two §2.4 adds', () => {
    expect(TRYON_FAILURE_CODES).toEqual(
      expect.arrayContaining([
        ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
        ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
        ErrorCode.MODERATION_REJECTED,
        ErrorCode.UPSTREAM_TIMEOUT,
        ErrorCode.UPSTREAM_UNAVAILABLE,
        ErrorCode.UPSTREAM_RATE_LIMITED,
        ErrorCode.QUOTA_EXHAUSTED,
        ErrorCode.BUDGET_EXHAUSTED,
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
        ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
      ]),
    );
  });

  it('retries exactly the three the PRD says to back off on, and nothing else', () => {
    const retrying = TRYON_FAILURE_CODES.filter(
      (code) => failureBehaviourFor(code).retry === 'BACKOFF',
    );

    expect(retrying.sort()).toEqual(
      [
        ErrorCode.UPSTREAM_TIMEOUT,
        ErrorCode.UPSTREAM_UNAVAILABLE,
        ErrorCode.UPSTREAM_RATE_LIMITED,
      ].sort(),
    );
  });

  it('flags a garment for review only when the upstream could not read the piece (A-15)', () => {
    const flagging = TRYON_FAILURE_CODES.filter(
      (code) => failureBehaviourFor(code).flagGarmentForReview,
    );

    expect(flagging.sort()).toEqual(
      [ErrorCode.UPSTREAM_NO_GARMENT_DETECTED, ErrorCode.UPSTREAM_INVALID_RESPONSE].sort(),
    );
  });

  it('queues moderation only for a moderation rejection, and discloses no detail', () => {
    expect(failureBehaviourFor(ErrorCode.MODERATION_REJECTED)).toMatchObject({
      queueModeration: true,
      retry: 'NONE',
    });
    // §8.3: "neutral request for a different photo … no detail disclosed".
    expect(consumerMessageFor(ErrorCode.MODERATION_REJECTED)).toBe(
      "Let's try a different photo — choose another and we'll carry on from here.",
    );
  });

  it('alerts an admin only where the PRD asks for it', () => {
    const alerting = TRYON_FAILURE_CODES.filter((code) => failureBehaviourFor(code).alertAdmin);

    expect(alerting.sort()).toEqual(
      [ErrorCode.BUDGET_EXHAUSTED, ErrorCode.TRYON_PROVIDER_MISCONFIGURED].sort(),
    );
  });

  it('surfaces every condition to the consumer except the rate limit (§2.4)', () => {
    const silent = TRYON_FAILURE_CODES.filter(
      (code) => !failureBehaviourFor(code).surfacedToConsumer,
    );

    // "Silent. The job stays RUNNING and the SSE stream stays open."
    expect(silent).toEqual([ErrorCode.UPSTREAM_RATE_LIMITED]);
  });

  it('takes every consumer message from ERROR_CODE_SPECS and restates none of them', () => {
    for (const code of TRYON_FAILURE_CODES) {
      expect(consumerMessageFor(code)).toBe(ERROR_CODE_SPECS[code].message);
      expect(consumerMessageFor(code).length).toBeGreaterThan(0);
    }
  });

  it('treats an unlisted code conservatively: no retry, no flag, but she is told', () => {
    const behaviour = failureBehaviourFor(ErrorCode.INTERNAL_ERROR);

    expect(behaviour).toMatchObject({
      retry: 'NONE',
      flagGarmentForReview: false,
      queueModeration: false,
      surfacedToConsumer: true,
    });
  });

  it('has no row anywhere that would charge for a failure', () => {
    // There is no "charge" column, and there must never be one: the only call site of
    // `QuotaPort.chargeSuccess()` is the SUCCEEDED branch of the runner.
    for (const code of TRYON_FAILURE_CODES) {
      expect(Object.keys(TRYON_FAILURE_POLICY[code] ?? {})).not.toContain('charge');
    }
  });
});
