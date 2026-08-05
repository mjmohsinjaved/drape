import { ErrorCode, Role, UserStatus, type ICurrentUser } from '@library/common';

import { ConsentStatus } from '@api/modules/consents';
import { hasApprovedTestRender } from '@api/modules/garments';
import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';

import { JobStatus } from '../enums/job-status.enum';

import type { PersonPhotoRef } from '../ports/person-photo.port';

/**
 * **The §8.1 step-3 guard chain, as ten pure predicates.** PRD E-5.
 *
 * > "Guard chain, entirely before any spend."
 *
 * Every one of these is a function from facts to an `ErrorCode`. No repository, no
 * container, no clock, no mocking — which is the entire point. E-5 asks for unit
 * coverage of this chain, and a chain built out of methods on a service with nine
 * injected collaborators makes that coverage an act of heroism. Built this way, each
 * predicate's test is three lines, the boundary cases (quota exactly zero, budget
 * exactly at the hard stop) are trivial to state, and the composition is tested
 * separately for **order** rather than for arithmetic.
 *
 * `TryOnGuardService` gathers the facts, in order, and calls these. It stops at the
 * first rejection — so a request from a suspended account never costs a quota lookup,
 * let alone a generation.
 *
 * The order below is the order §2.4's guard-chain table gives, and it is not
 * arbitrary: cheap and identity-shaped checks first, then the two that decide whether
 * anyone may spend at all, then the resource-shaped ones. Reordering it changes which
 * error a consumer sees when two things are wrong at once, so the composition spec
 * asserts the order explicitly.
 */

/** A refusal: the code §2.4 names, plus whatever the UI needs to render the state. */
export interface GuardRejection {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
}

/** Convenience for a rejection with no details. */
function reject(code: ErrorCode, details?: Record<string, unknown>): GuardRejection {
  return details === undefined ? { code } : { code, details };
}

/* -------------------------------------------------------------------------------------------------
 * 1 — session valid
 * ---------------------------------------------------------------------------------------------- */

/**
 * `SessionAuthGuard` has normally already refused an anonymous caller, and `RolesGuard`
 * an admin. This predicate is not redundant with them: it is the one that runs inside
 * the spend path, and it means the chain is complete and testable on its own rather
 * than complete only when composed with two global guards.
 */
export function checkSession(user: ICurrentUser | undefined): GuardRejection | null {
  if (user === undefined) {
    return reject(ErrorCode.AUTH_REQUIRED);
  }
  if (user.role !== Role.CONSUMER) {
    // §8.1 step 2: "asserts the role is Consumer". An admin who wants a render uses
    // the A-11 test-render route, which spends budget under its own reason.
    return reject(ErrorCode.INSUFFICIENT_ROLE);
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * 2 — account active and not suspended
 * ---------------------------------------------------------------------------------------------- */

/** A-19: suspension blocks generation and enquiry while preserving her data. */
export function checkAccountStatus(status: UserStatus): GuardRejection | null {
  if (status === UserStatus.SUSPENDED) {
    return reject(ErrorCode.ACCOUNT_SUSPENDED);
  }
  if (status === UserStatus.DEACTIVATED) {
    return reject(ErrorCode.ACCOUNT_DEACTIVATED);
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * 3 — email verified if settings require it
 * ---------------------------------------------------------------------------------------------- */

/**
 * A-28 / C-3, gated on `settings['quota.requireEmailVerification']` — §8.4 lists email
 * verification before the first generation as a cost control, and A-28 lets an admin
 * turn it off. When it is off, an unverified address is not an error.
 */
export function checkEmailVerified(
  emailVerifiedAt: Date | null,
  required: boolean,
): GuardRejection | null {
  if (!required) {
    return null;
  }
  return emailVerifiedAt === null ? reject(ErrorCode.EMAIL_NOT_VERIFIED) : null;
}

/* -------------------------------------------------------------------------------------------------
 * 4 and 5 — consent recorded at the current policy version
 * ---------------------------------------------------------------------------------------------- */

/**
 * C-12. Two codes, because the consumer feels the difference: one says "before your
 * first try-on", the other says "have a read and confirm to carry on".
 *
 * The status itself comes from `ConsentsService.resolveStatus()` — the only
 * implementation of the predicate — so this function decides the *code*, never the
 * comparison.
 */
export function checkConsent(status: ConsentStatus): GuardRejection | null {
  if (status === ConsentStatus.REQUIRED) {
    return reject(ErrorCode.CONSENT_REQUIRED);
  }
  if (status === ConsentStatus.STALE) {
    return reject(ErrorCode.CONSENT_STALE);
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * 6 — monthly quota remaining
 * ---------------------------------------------------------------------------------------------- */

/**
 * The boundary that matters: **zero remaining is exhausted.**
 *
 * `remaining` is derived from the append-only ledger (§4.0 rule 10), so it can go
 * negative if a grant is reduced mid-period; anything at or below zero refuses.
 * `details.resetsAt` is what lets the UI say when it comes back without the client
 * having to know the `Asia/Karachi` period boundary.
 */
export function checkQuota(remaining: number, resetsAt?: Date): GuardRejection | null {
  if (remaining > 0) {
    return null;
  }
  return reject(
    ErrorCode.QUOTA_EXHAUSTED,
    resetsAt === undefined ? { remaining } : { remaining, resetsAt: resetsAt.toISOString() },
  );
}

/* -------------------------------------------------------------------------------------------------
 * 7 — per-hour and per-IP rate limits
 * ---------------------------------------------------------------------------------------------- */

/** One rolling-hour window: how many generations have been started, and the ceiling. */
export interface RateWindow {
  readonly used: number;
  readonly limit: number;
  /** Seconds until the oldest entry leaves the window. */
  readonly retryAfterSeconds: number;
}

/**
 * C-6 — the per-account and per-IP ceilings that sit *above* the monthly quota.
 *
 * Both are checked, account first, because an account limit is the one she can act on
 * ("give it a minute") while an IP limit is usually somebody else on the same network.
 * `details.retryAfterSeconds` populates the `Retry-After` header §2.4 asks for.
 */
export function checkRateLimits(perAccount: RateWindow, perIp: RateWindow): GuardRejection | null {
  for (const [scope, window] of [
    ['ACCOUNT', perAccount],
    ['IP', perIp],
  ] as const) {
    if (window.limit > 0 && window.used >= window.limit) {
      return reject(ErrorCode.RATE_LIMIT_EXCEEDED, {
        scope,
        retryAfterSeconds: window.retryAfterSeconds,
      });
    }
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * 8 — system-wide budget not exhausted
 * ---------------------------------------------------------------------------------------------- */

/**
 * A-29 / §8.3. **The hard stop is inclusive**: consumption equal to the limit is
 * exhausted, because the limit is the number of generations the month may contain and
 * the next one would be the limit-plus-first.
 *
 * A limit of zero therefore refuses everything, which is the correct reading of an
 * admin who set the budget to zero.
 */
export function checkBudget(consumed: number, hardStopAt: number): GuardRejection | null {
  if (consumed < hardStopAt) {
    return null;
  }
  return reject(ErrorCode.BUDGET_EXHAUSTED, { consumed, hardStopAt });
}

/* -------------------------------------------------------------------------------------------------
 * 9 and 10 — garment published with an approved test render
 * ---------------------------------------------------------------------------------------------- */

/**
 * A-11 / E-10, restated at the point of spend.
 *
 * A missing garment and an unpublished one are **indistinguishable by design** (§2.4):
 * both are `GARMENT_NOT_PUBLISHED`, so the catalogue's draft pipeline is not
 * enumerable by a consumer with a uuid generator.
 *
 * The approved-test-render question is delegated to `hasApprovedTestRender()` from the
 * garments module rather than re-derived from two columns here — E-10 exists precisely
 * to stop "approved" meaning one thing at publish time and another at try-on time.
 */
export function checkGarmentReady(garment: Garment | null): GuardRejection | null {
  if (garment === null || garment.publishState !== PublishState.PUBLISHED) {
    return reject(ErrorCode.GARMENT_NOT_PUBLISHED);
  }
  if (!hasApprovedTestRender(garment)) {
    return reject(ErrorCode.TEST_RENDER_REQUIRED);
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * 11 — the referenced photo belongs to this user
 * ---------------------------------------------------------------------------------------------- */

/**
 * §9.2 object-level ownership, plus the moderation gate.
 *
 * Three outcomes, and the distinction between the first two is the whole point:
 *
 *  - no photo at all → `PHOTO_NOT_FOUND`;
 *  - somebody else's photo → `PHOTO_NOT_OWNED`, which `GlobalExceptionFilter` **masks**
 *    to `PHOTO_NOT_FOUND` before it reaches the client while logging the true code
 *    (§2.4 masking rule, E-7). The service throws the true code; nothing here decides
 *    what the client sees;
 *  - a photo blocked by moderation → `PHOTO_BLOCKED_BY_MODERATION`, whose copy is the
 *    same neutral "let's try a different photo" as an upstream moderation rejection,
 *    because disclosing which is which discloses the moderation outcome.
 *
 * A `PENDING` photo is allowed through: moderation in V1 is post-hoc on the render
 * path, and refusing every photo until a human looked at it would make the product
 * unusable. Only an explicit `BLOCKED` stops a generation.
 */
export function checkPhotoOwnership(
  photo: PersonPhotoRef | null,
  userId: string,
): GuardRejection | null {
  if (photo === null) {
    return reject(ErrorCode.PHOTO_NOT_FOUND);
  }
  if (photo.userId !== userId) {
    return reject(ErrorCode.PHOTO_NOT_OWNED);
  }
  if (photo.moderationState === PhotoModerationState.BLOCKED) {
    return reject(ErrorCode.PHOTO_BLOCKED_BY_MODERATION);
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * 12 — idempotency key not already in flight or completed
 * ---------------------------------------------------------------------------------------------- */

/** What the chain needs to know about a job that already used this idempotency key. */
export interface ExistingJobFacts {
  readonly id: string;
  readonly status: JobStatus;
}

/**
 * §8.4 — "idempotency keys prevent double-click double-charging".
 *
 * A job that is still `QUEUED` or `RUNNING` is `IDEMPOTENCY_IN_FLIGHT` with
 * `details.jobId`, so the client attaches to the existing SSE stream instead of
 * starting a second generation (§2.4).
 *
 * A `SUCCEEDED` job is **not** a rejection — the caller replays its result, which is
 * why this returns `null` for it. `FAILED` and `CANCELLED` are not rejections either:
 * a failed job charged nothing, so retrying the same key is exactly what a client
 * should do.
 */
export function checkIdempotency(existing: ExistingJobFacts | null): GuardRejection | null {
  if (existing === null) {
    return null;
  }
  if (existing.status === JobStatus.QUEUED || existing.status === JobStatus.RUNNING) {
    return reject(ErrorCode.IDEMPOTENCY_IN_FLIGHT, { jobId: existing.id });
  }
  return null;
}

/**
 * The chain's declared order, for documentation and for the composition spec.
 *
 * This array is not iterated at runtime — the service is a straight-line sequence, so
 * a mis-ordered chain is a compile-visible edit rather than a data change. It exists so
 * a test can assert the order it *expects* against the order §2.4 documents.
 */
export const TRYON_GUARD_ORDER: readonly string[] = [
  'session',
  'accountStatus',
  'emailVerified',
  'consent',
  'quota',
  'rateLimits',
  'budget',
  'garment',
  'photoOwnership',
  'idempotency',
];
