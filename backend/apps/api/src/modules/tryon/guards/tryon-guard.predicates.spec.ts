import { ErrorCode, Locale, Role, UserStatus, type ICurrentUser } from '@library/common';

import { ConsentStatus } from '@api/modules/consents';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';
import { PhotoModerationState } from '@api/modules/person-photos';

import { JobStatus } from '../enums/job-status.enum';
import { buildTryableGarment, CONSUMER_ID, OTHER_CONSUMER_ID } from '../testing/tryon-harness';

import {
  checkAccountStatus,
  checkBudget,
  checkConsent,
  checkEmailVerified,
  checkGarmentReady,
  checkIdempotency,
  checkPhotoOwnership,
  checkQuota,
  checkRateLimits,
  checkSession,
  TRYON_GUARD_ORDER,
  type RateWindow,
} from './tryon-guard.predicates';

import type { PersonPhotoRef } from '../ports/person-photo.port';

/**
 * **PRD E-5 — unit coverage of the §8.1 step-3 guard chain.**
 *
 * Every predicate, individually, with the boundaries stated explicitly. These are the
 * ten conditions that stand between a request and real money, so each is exercised on
 * both sides of its line rather than only on the side that refuses.
 *
 * There is no container here, no repository and no clock. That is deliberate: a guard
 * chain whose unit tests need a database is a guard chain nobody adds a case to.
 */

const USER: ICurrentUser = {
  id: CONSUMER_ID,
  role: Role.CONSUMER,
  email: 'consumer@example.invalid',
  name: 'Test Consumer',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  sessionId: '77777777-7777-4777-8777-777777777777',
  locale: Locale.EN,
};

const PHOTO: PersonPhotoRef = {
  id: '55555555-5555-4555-8555-555555555555',
  userId: CONSUMER_ID,
  storageKey: `person-photos/${CONSUMER_ID}/photo.jpg`,
  hash: 'b'.repeat(64),
  label: 'daylight',
  moderationState: PhotoModerationState.APPROVED,
  mimeType: 'image/jpeg',
};

function window(used: number, limit: number): RateWindow {
  return { used, limit, retryAfterSeconds: 3_600 };
}

describe('try-on guard chain predicates (E-5)', () => {
  describe('1 — session valid', () => {
    it('refuses an anonymous caller with AUTH_REQUIRED', () => {
      expect(checkSession(undefined)).toEqual({ code: ErrorCode.AUTH_REQUIRED });
    });

    it('refuses an admin: §8.1 step 2 asserts the role is Consumer', () => {
      // An admin who wants a render uses the A-11 test-render route, which spends
      // budget under its own reason (§8.4) and never touches a consumer's quota.
      expect(checkSession({ ...USER, role: Role.ADMIN })).toEqual({
        code: ErrorCode.INSUFFICIENT_ROLE,
      });
    });

    it('admits a consumer', () => {
      expect(checkSession(USER)).toBeNull();
    });
  });

  describe('2 — account active and not suspended', () => {
    it.each([
      [UserStatus.SUSPENDED, ErrorCode.ACCOUNT_SUSPENDED],
      [UserStatus.DEACTIVATED, ErrorCode.ACCOUNT_DEACTIVATED],
    ])('refuses a %s account with %s', (status, code) => {
      expect(checkAccountStatus(status)).toEqual({ code });
    });

    it('admits an active account', () => {
      expect(checkAccountStatus(UserStatus.ACTIVE)).toBeNull();
    });
  });

  describe('3 — email verified if settings require it', () => {
    it('refuses an unverified address when verification is required', () => {
      expect(checkEmailVerified(null, true)).toEqual({ code: ErrorCode.EMAIL_NOT_VERIFIED });
    });

    it('admits an unverified address when an admin has turned the requirement off (A-28)', () => {
      // §8.4 lists email verification as a cost control and A-28 makes it a setting.
      // When it is off, an unverified address is not an error.
      expect(checkEmailVerified(null, false)).toBeNull();
    });

    it('admits a verified address', () => {
      expect(checkEmailVerified(new Date('2026-08-01T00:00:00.000Z'), true)).toBeNull();
    });
  });

  describe('4 and 5 — consent at the current policy version', () => {
    it('refuses a consumer who has never consented with CONSENT_REQUIRED', () => {
      expect(checkConsent(ConsentStatus.REQUIRED)).toEqual({ code: ErrorCode.CONSENT_REQUIRED });
    });

    it('refuses a consumer exactly one policy version stale with CONSENT_STALE (C-12)', () => {
      // The distinction is felt by the consumer: one screen says "before your first
      // try-on", the other says "have a read and confirm to carry on". A single
      // CONSENT_REQUIRED for both would tell a returning consumer she never consented.
      expect(checkConsent(ConsentStatus.STALE)).toEqual({ code: ErrorCode.CONSENT_STALE });
    });

    it('admits consent recorded at the current version', () => {
      expect(checkConsent(ConsentStatus.GRANTED)).toBeNull();
    });
  });

  describe('6 — monthly quota remaining', () => {
    it('admits at exactly one remaining — the last generation of the month is allowed', () => {
      expect(checkQuota(1)).toBeNull();
    });

    it('**refuses at exactly zero** — the boundary', () => {
      expect(checkQuota(0)).toMatchObject({ code: ErrorCode.QUOTA_EXHAUSTED });
    });

    it('refuses a negative balance, which a mid-period grant reduction can produce', () => {
      // Remaining is derived from an append-only ledger (§4.0 rule 10), so it can go
      // negative if an admin lowers an override after she has spent. Anything at or
      // below zero refuses.
      expect(checkQuota(-3)).toMatchObject({ code: ErrorCode.QUOTA_EXHAUSTED });
    });

    it('carries resetsAt so the UI can say when it comes back', () => {
      const resetsAt = new Date('2026-09-01T00:00:00.000Z');

      expect(checkQuota(0, resetsAt)).toEqual({
        code: ErrorCode.QUOTA_EXHAUSTED,
        details: { remaining: 0, resetsAt: resetsAt.toISOString() },
      });
    });
  });

  describe('7 — per-hour and per-IP rate limits (C-6)', () => {
    it('admits one below the account ceiling', () => {
      expect(checkRateLimits(window(19, 20), window(0, 40))).toBeNull();
    });

    it('refuses at exactly the account ceiling', () => {
      expect(checkRateLimits(window(20, 20), window(0, 40))).toMatchObject({
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        details: { scope: 'ACCOUNT', retryAfterSeconds: 3_600 },
      });
    });

    it('refuses at exactly the IP ceiling', () => {
      expect(checkRateLimits(window(0, 20), window(40, 40))).toMatchObject({
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        details: { scope: 'IP' },
      });
    });

    it('reports the account scope first when both are over', () => {
      // The account limit is the one she can act on; the IP limit is usually somebody
      // else on the same network.
      expect(checkRateLimits(window(99, 20), window(99, 40))).toMatchObject({
        details: { scope: 'ACCOUNT' },
      });
    });

    it('treats a limit of zero as "not configured" rather than "refuse everything"', () => {
      expect(checkRateLimits(window(5, 0), window(5, 0))).toBeNull();
    });
  });

  describe('8 — system-wide budget not exhausted (A-29)', () => {
    it('admits one below the hard stop', () => {
      expect(checkBudget(1_999, 2_000)).toBeNull();
    });

    it('**refuses at exactly the hard stop** — the boundary', () => {
      // The limit is how many generations the month may contain, so consumption equal
      // to it means the next one would be the limit-plus-first.
      expect(checkBudget(2_000, 2_000)).toMatchObject({ code: ErrorCode.BUDGET_EXHAUSTED });
    });

    it('refuses everything when an admin has set the budget to zero', () => {
      expect(checkBudget(0, 0)).toMatchObject({ code: ErrorCode.BUDGET_EXHAUSTED });
    });
  });

  describe('9 and 10 — garment published with an approved test render (A-11, E-10)', () => {
    it('admits a published garment carrying an approved render', () => {
      expect(checkGarmentReady(buildTryableGarment())).toBeNull();
    });

    it('reports a missing garment and an unpublished one identically, by design', () => {
      // §2.4: "Indistinguishable from 'not found' by design" — the draft pipeline must
      // not be enumerable by a consumer with a uuid generator.
      const missing = checkGarmentReady(null);
      const draft = checkGarmentReady(buildTryableGarment({ publishState: PublishState.DRAFT }));

      expect(missing).toEqual({ code: ErrorCode.GARMENT_NOT_PUBLISHED });
      expect(draft).toEqual(missing);
    });

    it('refuses an archived garment', () => {
      expect(
        checkGarmentReady(buildTryableGarment({ publishState: PublishState.ARCHIVED })),
      ).toEqual({ code: ErrorCode.GARMENT_NOT_PUBLISHED });
    });

    it.each([
      ['never rendered', { testRenderState: TestRenderState.NONE, testRenderApprovedAt: null }],
      [
        'awaiting approval',
        { testRenderState: TestRenderState.PENDING, testRenderApprovedAt: null },
      ],
      ['rejected', { testRenderState: TestRenderState.REJECTED, testRenderApprovedAt: null }],
      [
        'marked approved with no approval timestamp',
        { testRenderState: TestRenderState.APPROVED, testRenderApprovedAt: null },
      ],
    ])('refuses a published garment whose test render is %s (E-10)', (_label, overrides) => {
      // The last case is the one worth having: both columns are required, so a
      // half-applied migration or a hand-edited row cannot pass the gate.
      expect(checkGarmentReady(buildTryableGarment(overrides))).toEqual({
        code: ErrorCode.TEST_RENDER_REQUIRED,
      });
    });
  });

  describe('11 — the referenced photo belongs to this user (§9.2)', () => {
    it('admits her own approved photo', () => {
      expect(checkPhotoOwnership(PHOTO, CONSUMER_ID)).toBeNull();
    });

    it('reports no photo as PHOTO_NOT_FOUND', () => {
      expect(checkPhotoOwnership(null, CONSUMER_ID)).toEqual({ code: ErrorCode.PHOTO_NOT_FOUND });
    });

    it("reports another account's photo as PHOTO_NOT_OWNED, the code the filter masks", () => {
      // The true code is thrown and logged; §2.4's masking rule turns it into
      // PHOTO_NOT_FOUND before it reaches the client. E-7 asserts both halves.
      expect(checkPhotoOwnership({ ...PHOTO, userId: OTHER_CONSUMER_ID }, CONSUMER_ID)).toEqual({
        code: ErrorCode.PHOTO_NOT_OWNED,
      });
    });

    it('refuses a photo blocked by moderation, with the neutral code', () => {
      expect(
        checkPhotoOwnership(
          { ...PHOTO, moderationState: PhotoModerationState.BLOCKED },
          CONSUMER_ID,
        ),
      ).toEqual({ code: ErrorCode.PHOTO_BLOCKED_BY_MODERATION });
    });

    it('admits a photo still pending moderation', () => {
      // Moderation in V1 is post-hoc on the render path. Refusing every photo until a
      // human looked at it would make the product unusable; only an explicit BLOCKED
      // stops a generation.
      expect(
        checkPhotoOwnership(
          { ...PHOTO, moderationState: PhotoModerationState.PENDING },
          CONSUMER_ID,
        ),
      ).toBeNull();
    });
  });

  describe('12 — idempotency key not already in flight (§8.4)', () => {
    const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    it('admits an unused key', () => {
      expect(checkIdempotency(null)).toBeNull();
    });

    it.each([JobStatus.QUEUED, JobStatus.RUNNING])(
      'refuses a %s job with IDEMPOTENCY_IN_FLIGHT carrying the job id',
      (status) => {
        // `details.jobId` is what lets the client attach to the existing SSE stream
        // instead of starting a second generation (§2.4).
        expect(checkIdempotency({ id: jobId, status })).toEqual({
          code: ErrorCode.IDEMPOTENCY_IN_FLIGHT,
          details: { jobId },
        });
      },
    );

    it('does not refuse a SUCCEEDED job — the caller replays its result', () => {
      expect(checkIdempotency({ id: jobId, status: JobStatus.SUCCEEDED })).toBeNull();
    });

    it.each([JobStatus.FAILED, JobStatus.CANCELLED])(
      'does not refuse a %s job — it charged nothing, so retrying the key is correct',
      (status) => {
        expect(checkIdempotency({ id: jobId, status })).toBeNull();
      },
    );
  });

  it('declares the ten steps in the §2.4 order', () => {
    expect(TRYON_GUARD_ORDER).toEqual([
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
    ]);
  });
});
