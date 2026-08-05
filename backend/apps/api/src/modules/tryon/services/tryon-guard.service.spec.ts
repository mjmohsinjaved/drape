import { ErrorCode, MetricsService, UserStatus } from '@library/common';

import { ConsentStatus } from '@api/modules/consents';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import {
  buildTryableGarment,
  CONSUMER,
  createTryOnContext,
  GARMENT_ID,
  type TryOnTestContext,
} from '../testing/tryon-harness';

import type { TryOnGuardInput } from './tryon-guard.service';

/**
 * **The guard chain, composed — PRD §8.1 step 3.**
 *
 * The predicates are tested individually next door. What this file is about is the one
 * thing composition adds: **order**. Two things are usually wrong at once, and which
 * error surfaces decides which screen she lands on — so every test here arranges
 * several simultaneous failures and asserts which code wins.
 *
 * It also asserts the property that makes the chain worth having at all: a refusal
 * costs nothing. No `tryon_jobs` row, no charge, no upstream call (§2.4).
 */

function request(overrides: Partial<TryOnGuardInput> = {}): TryOnGuardInput {
  return {
    user: CONSUMER,
    garmentId: GARMENT_ID,
    idempotencyKey: 'idem-0000-0001',
    ip: '203.0.113.10',
    ...overrides,
  };
}

describe('TryOnGuardService — §8.1 step 3, composed', () => {
  let context: TryOnTestContext;

  afterEach(async () => {
    await context.close();
  });

  describe('the §2.4 order decides which of several simultaneous failures she sees', () => {
    it('session before everything: an anonymous caller is refused before a quota lookup', async () => {
      context = await createTryOnContext();
      context.quota.quotaRemaining = 0;

      await expect(
        context.guards.assertMayGenerate(request({ user: undefined })),
      ).rejects.toMatchObject({ errorCode: ErrorCode.AUTH_REQUIRED });

      // The chain short-circuited: nothing downstream was even asked.
      expect(context.quota.assertQuotaAvailable).not.toHaveBeenCalled();
      expect(context.consents.resolveStatus).not.toHaveBeenCalled();
    });

    it('account status before email verification', async () => {
      context = await createTryOnContext();

      await expect(
        context.guards.assertMayGenerate(
          request({ user: { ...CONSUMER, status: UserStatus.SUSPENDED, emailVerifiedAt: null } }),
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.ACCOUNT_SUSPENDED });
    });

    it('email verification before consent', async () => {
      context = await createTryOnContext({ consentStatus: ConsentStatus.REQUIRED });

      await expect(
        context.guards.assertMayGenerate(request({ user: { ...CONSUMER, emailVerifiedAt: null } })),
      ).rejects.toMatchObject({ errorCode: ErrorCode.EMAIL_NOT_VERIFIED });

      expect(context.consents.resolveStatus).not.toHaveBeenCalled();
    });

    it('consent before quota', async () => {
      context = await createTryOnContext({ consentStatus: ConsentStatus.STALE });
      context.quota.quotaRemaining = 0;

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.CONSENT_STALE,
      });

      expect(context.quota.assertQuotaAvailable).not.toHaveBeenCalled();
    });

    it('quota before the rate limits', async () => {
      context = await createTryOnContext({ env: { TRYON_RATE_PER_HOUR: 0 } });
      context.quota.quotaRemaining = 0;

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.QUOTA_EXHAUSTED,
      });
    });

    it('the rate limits before the budget — §2.4 puts C-6 between steps 6 and 8', async () => {
      // This is the ordering `GenerationSpendService.assertCanGenerate()` cannot
      // express, and the reason the port exposes the two assertions separately.
      context = await createTryOnContext({ env: { TRYON_RATE_PER_IP_HOUR: 1 } });
      context.quota.budgetUsed = context.quota.budgetLimit;
      context.rateLimits.recordIpHit('203.0.113.10');

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.RATE_LIMIT_EXCEEDED,
      });

      expect(context.quota.assertBudgetAvailable).not.toHaveBeenCalled();
    });

    it('budget before the garment lookup', async () => {
      context = await createTryOnContext({ garment: null });
      context.quota.budgetUsed = context.quota.budgetLimit;

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.BUDGET_EXHAUSTED,
      });
    });

    it('the garment before the photo', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({ publishState: PublishState.DRAFT }),
      });

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.GARMENT_NOT_PUBLISHED,
      });

      expect(context.photos.resolveGenerationPhoto).not.toHaveBeenCalled();
    });

    it('the test-render gate before the photo (A-11)', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({
          testRenderState: TestRenderState.PENDING,
          testRenderApprovedAt: null,
        }),
      });

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.TEST_RENDER_REQUIRED,
      });
    });

    it('the photo before the idempotency key', async () => {
      context = await createTryOnContext();
      context.photos.failWith = Object.assign(new Error('no photo'), {
        errorCode: ErrorCode.PHOTO_NOT_FOUND,
      });

      await expect(context.guards.assertMayGenerate(request())).rejects.toThrow('no photo');
    });
  });

  describe('what a refusal costs', () => {
    it('writes no job row and charges nothing, whichever guard refuses', async () => {
      context = await createTryOnContext({ consentStatus: ConsentStatus.REQUIRED });

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.CONSENT_REQUIRED,
      });

      // §2.4: "No `tryon_jobs` row is written for a guard-chain rejection."
      expect(context.harness.repository(TryOnJob).$rows).toHaveLength(0);
      expect(context.quota.charges).toHaveLength(0);
    });

    it('emits tryon.guard_rejected tagged with the refusing code (E-13)', async () => {
      context = await createTryOnContext({ consentStatus: ConsentStatus.REQUIRED });

      await expect(context.guards.assertMayGenerate(request())).rejects.toThrow();

      const snapshot = context.harness.get<MetricsService>(MetricsService).snapshot();

      expect(snapshot?.series).toContainEqual(
        expect.objectContaining({
          name: 'tryon.guard_rejected',
          tags: expect.objectContaining({ errorCode: ErrorCode.CONSENT_REQUIRED }),
        }),
      );
    });
  });

  describe('what a pass returns', () => {
    it('hands back everything it resolved, so nothing is fetched twice', async () => {
      context = await createTryOnContext();

      const outcome = await context.guards.assertMayGenerate(request());

      expect(outcome.garment.id).toBe(GARMENT_ID);
      expect(outcome.photo.userId).toBe(CONSUMER.id);
      expect(outcome.quota.remaining).toBeGreaterThan(0);
      expect(outcome.budget.remaining).toBeGreaterThan(0);
      expect(outcome.completedJob).toBeNull();
    });

    it('surfaces a completed job under the same key so the caller can replay it', async () => {
      context = await createTryOnContext();
      const jobs = context.harness.repository<TryOnJob>(TryOnJob);
      jobs.$seed([
        Object.assign(new TryOnJob(), {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          userId: CONSUMER.id,
          idempotencyKey: 'idem-0000-0001',
          status: JobStatus.SUCCEEDED,
          deletedAt: null,
        }),
      ]);

      const outcome = await context.guards.assertMayGenerate(request());

      expect(outcome.completedJob?.id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    });

    it('refuses a key whose job is still running, with the job id attached', async () => {
      context = await createTryOnContext();
      context.harness.repository<TryOnJob>(TryOnJob).$seed([
        Object.assign(new TryOnJob(), {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          userId: CONSUMER.id,
          idempotencyKey: 'idem-0000-0001',
          status: JobStatus.RUNNING,
          deletedAt: null,
        }),
      ]);

      await expect(context.guards.assertMayGenerate(request())).rejects.toMatchObject({
        errorCode: ErrorCode.IDEMPOTENCY_IN_FLIGHT,
        details: { jobId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      });
    });
  });
});
