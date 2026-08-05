import { ERROR_CODE_SPECS, ErrorCode } from '@library/common';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { TryOnCache } from '../entities/tryon-cache.entity';
import { TryOnJob } from '../entities/tryon-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import {
  ADMIN,
  CONSUMER,
  createTryOnContext,
  GARMENT_ID,
  REPLACEMENT_PHOTO_HASH,
  type TryOnTestContext,
} from '../testing/tryon-harness';

import { failureBehaviourFor } from './tryon-failure.policy';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { CreateTryOnDto } from '../dto/create-tryon.dto';
import type { TryOnProviderErrorCode } from '../providers/tryon-provider.interface';

/**
 * **PRD E-6 — one integration test per branch of the §8.3 failure taxonomy.**
 *
 * > "Failed jobs never consume quota or budget."
 *
 * That sentence is the reason this file exists, and it is asserted on **every** failure
 * path rather than on a representative one. The stack under test is real: the real
 * guard chain, the real runner, the real cache, the real `MockTryOnProvider`. Only
 * storage, thumbnailing and the two ports are doubled, and the quota double is a spy
 * whose `charges` array being empty *is* the assertion.
 *
 * Each branch also checks the two things a consumer and an operator respectively
 * depend on: the exact consumer-facing message (from `ERROR_CODE_SPECS`, which takes
 * the ✔︎ strings verbatim from PRD §8.3), and the retry behaviour the taxonomy
 * prescribes.
 */

const DTO: CreateTryOnDto = {
  garmentId: GARMENT_ID,
  idempotencyKey: 'idem-0000-0001',
};

/**
 * Makes the in-memory jobs repository behave like `UQ_tryon_jobs_idem`.
 *
 * The fixture deliberately does not emulate unique indexes (they are database
 * behaviour), but the idempotency story *is* that index — so the one test that is
 * about it teaches the fixture to raise `23505` exactly where PostgreSQL would.
 */
function enforceIdempotencyIndex(jobs: InMemoryRepository<TryOnJob>): void {
  const save = jobs.save as unknown as jest.Mock<Promise<TryOnJob>, [TryOnJob]>;
  const stored = save.getMockImplementation() as (entity: TryOnJob) => Promise<TryOnJob>;

  save.mockImplementation(async (entity: TryOnJob) => {
    const clash = jobs.$rows.some(
      (existing) =>
        existing.userId === entity.userId &&
        existing.idempotencyKey === entity.idempotencyKey &&
        existing.id !== entity.id,
    );
    if (clash) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      });
    }
    return stored(entity);
  });
}

describe('TryOnService — the §8.1 request path', () => {
  let context: TryOnTestContext;

  afterEach(async () => {
    await context.close();
  });

  /* ---------------------------------------------------------------------------------------
   * The happy path, so the failures below mean something
   * ------------------------------------------------------------------------------------ */

  describe('a successful generation (§8.1 steps 5–6)', () => {
    it('stores the render, writes the cache entry, charges once, and marks the job succeeded', async () => {
      context = await createTryOnContext();

      const response = await context.tryOn.create(DTO, CONSUMER, '203.0.113.10');

      expect(response.status).toBe(JobStatus.SUCCEEDED);
      expect(response.cacheHit).toBe(false);
      expect(response.result).not.toBeNull();

      // The render lives in her own namespace (§3.3, §3.7).
      expect(response.result?.url).toContain(`renders/${CONSUMER.id}/`);

      // §8.4: quota and budget decrement only on success — exactly once.
      expect(context.quota.charges).toEqual([
        expect.objectContaining({ origin: 'CONSUMER', userId: CONSUMER.id }),
      ]);

      const [cached] = context.harness.repository<TryOnCache>(TryOnCache).$rows;
      expect(cached).toBeDefined();
      expect(cached?.storageKey).toContain(`renders/${CONSUMER.id}/`);
    });

    it('writes the §4.18 snapshots so history survives the garment and the photo', async () => {
      context = await createTryOnContext();

      await context.tryOn.create(DTO, CONSUMER);

      const [result] = context.harness.repository<TryOnResult>(TryOnResult).$rows;
      expect(result).toMatchObject({
        garmentTitleSnapshot: 'Ivory Chikankari Kurta',
        garmentCategorySnapshot: 'Bridal Lehenga',
        garmentPriceSnapshot: 185_000,
        garmentCurrencySnapshot: 'PKR',
        personPhotoLabelSnapshot: 'daylight',
        isTestRender: false,
      });
    });

    it('counts the try-on against the garment for the A-14 "most tried" ordering', async () => {
      context = await createTryOnContext();

      await context.tryOn.create(DTO, CONSUMER);

      const [garment] = context.harness.repository<Garment>(Garment).$rows;
      expect(garment?.tryOnCount).toBe(1);
      expect(garment?.lastTriedAt).toBeInstanceOf(Date);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * E-6 — every branch of the §8.3 table
   * ------------------------------------------------------------------------------------ */

  describe('the §8.3 failure taxonomy (E-6)', () => {
    interface Branch {
      readonly label: string;
      readonly simulated: TryOnProviderErrorCode;
      /** What the consumer is told about — after the §2.4 terminal-code mapping. */
      readonly surfaced: ErrorCode;
      /** Upstream calls the taxonomy permits. */
      readonly attempts: number;
      readonly flagsGarment: boolean;
    }

    const BRANCHES: readonly Branch[] = [
      {
        label: 'No garment detected',
        simulated: ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
        surfaced: ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
        attempts: 1,
        flagsGarment: true,
      },
      {
        label: 'Unsupported or corrupt format',
        simulated: ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
        surfaced: ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
        attempts: 1,
        flagsGarment: false,
      },
      {
        label: 'Moderation rejection',
        simulated: ErrorCode.MODERATION_REJECTED,
        surfaced: ErrorCode.MODERATION_REJECTED,
        attempts: 1,
        flagsGarment: false,
      },
      {
        label: 'Timeout',
        simulated: ErrorCode.UPSTREAM_TIMEOUT,
        surfaced: ErrorCode.UPSTREAM_TIMEOUT,
        attempts: 3,
        flagsGarment: false,
      },
      {
        label: 'Upstream 5xx',
        simulated: ErrorCode.UPSTREAM_UNAVAILABLE,
        surfaced: ErrorCode.UPSTREAM_UNAVAILABLE,
        attempts: 3,
        flagsGarment: false,
      },
      {
        label: 'Upstream rate limit',
        simulated: ErrorCode.UPSTREAM_RATE_LIMITED,
        // §2.4: never surfaced. Once attempts are exhausted the job fails as unavailable.
        surfaced: ErrorCode.UPSTREAM_UNAVAILABLE,
        attempts: 3,
        flagsGarment: false,
      },
      {
        label: 'Malformed upstream payload',
        simulated: ErrorCode.UPSTREAM_INVALID_RESPONSE,
        surfaced: ErrorCode.UPSTREAM_INVALID_RESPONSE,
        attempts: 1,
        flagsGarment: true,
      },
      {
        label: 'Provider misconfigured',
        simulated: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
        surfaced: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
        attempts: 1,
        flagsGarment: false,
      },
    ];

    describe.each(BRANCHES)('$label', (branch) => {
      async function provoke(): Promise<unknown> {
        context = await createTryOnContext();
        context.provider.alwaysFail(branch.simulated);
        return context.tryOn.create(DTO, CONSUMER).catch((error: unknown) => error);
      }

      it('shows the consumer the §8.3 copy, verbatim from ERROR_CODE_SPECS', async () => {
        const error = (await provoke()) as { errorCode: ErrorCode; message: string };

        expect(error.errorCode).toBe(branch.surfaced);
        // Never an upstream string, never a reworded one (§2.4: fixed copy).
        expect(error.message).toBe(ERROR_CODE_SPECS[branch.surfaced].message);
      });

      it('**consumes no quota and no budget**', async () => {
        await provoke();

        expect(context.quota.charges).toHaveLength(0);
        expect(context.quota.chargeSuccess).not.toHaveBeenCalled();
      });

      it('marks the job FAILED with the code, and writes no result row', async () => {
        await provoke();

        const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;
        expect(job).toMatchObject({ status: JobStatus.FAILED, errorCode: branch.surfaced });
        expect(context.harness.repository<TryOnResult>(TryOnResult).$rows).toHaveLength(0);
      });

      it('applies the prescribed retry behaviour', async () => {
        await provoke();

        const behaviour = failureBehaviourFor(branch.simulated);
        expect(behaviour.retry).toBe(branch.attempts > 1 ? 'BACKOFF' : 'NONE');
      });

      it(
        branch.flagsGarment
          ? 'flags the garment for review (A-15)'
          : 'leaves the garment unflagged',
        async () => {
          await provoke();

          const [garment] = context.harness.repository<Garment>(Garment).$rows;
          expect(garment?.flaggedForReview).toBe(branch.flagsGarment);
          expect(garment?.failureCount).toBe(branch.flagsGarment ? 1 : 0);
        },
      );

      it('writes no cache entry, so the next attempt is a real attempt', async () => {
        await provoke();

        expect(context.harness.repository<TryOnCache>(TryOnCache).$rows).toHaveLength(0);
      });
    });

    it('spells the two most load-bearing strings exactly as PRD §8.3 does', async () => {
      // The libs/common spec asserts the whole table character for character; these two
      // are repeated here because they are the ones a consumer sees when money was at
      // stake, and a silent reword would otherwise only fail in another module.
      expect(ERROR_CODE_SPECS[ErrorCode.UPSTREAM_NO_GARMENT_DETECTED].message).toBe(
        "We're having trouble with this piece — we've been notified. Try another for now.",
      );
      expect(ERROR_CODE_SPECS[ErrorCode.UPSTREAM_TIMEOUT].message).toBe(
        'Taking longer than usual — hang tight.',
      );
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Guard-chain refusals reach the caller intact and cost nothing
   * ------------------------------------------------------------------------------------ */

  describe('the two §8.3 rows that are guard-chain refusals', () => {
    it('personal quota exhausted: the verbatim copy, no job, no charge', async () => {
      context = await createTryOnContext();
      context.quota.quotaRemaining = 0;

      const error = (await context.tryOn.create(DTO, CONSUMER).catch((e: unknown) => e)) as {
        errorCode: ErrorCode;
        message: string;
      };

      expect(error.errorCode).toBe(ErrorCode.QUOTA_EXHAUSTED);
      expect(error.message).toBe(
        "You've used your try-ons this month — your shortlist is saved, and you can send an enquiry any time.",
      );
      expect(context.harness.repository<TryOnJob>(TryOnJob).$rows).toHaveLength(0);
      expect(context.quota.charges).toHaveLength(0);
    });

    it('system budget exhausted: the verbatim copy, no job, no charge', async () => {
      context = await createTryOnContext();
      context.quota.budgetUsed = context.quota.budgetLimit;

      const error = (await context.tryOn.create(DTO, CONSUMER).catch((e: unknown) => e)) as {
        errorCode: ErrorCode;
        message: string;
      };

      expect(error.errorCode).toBe(ErrorCode.BUDGET_EXHAUSTED);
      expect(error.message).toBe(
        "Our fitting room is at capacity today — we'll email you when it's back.",
      );
      expect(context.harness.repository<TryOnJob>(TryOnJob).$rows).toHaveLength(0);
      expect(context.quota.charges).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * The cache (§3.7, §8.1 step 4, C-22)
   * ------------------------------------------------------------------------------------ */

  describe('the content-hash cache', () => {
    it('serves a second identical try-on from cache, charging nothing (C-22)', async () => {
      context = await createTryOnContext();

      const first = await context.tryOn.create(DTO, CONSUMER);
      const second = await context.tryOn.create(
        { ...DTO, idempotencyKey: 'idem-0000-0002' },
        CONSUMER,
      );

      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(true);

      // One generation, one charge — the second cost a file copy.
      expect(context.quota.charges).toHaveLength(1);
    });

    it('returns the same bytes on a hit', async () => {
      context = await createTryOnContext();

      const first = await context.tryOn.create(DTO, CONSUMER);
      const second = await context.tryOn.create(
        { ...DTO, idempotencyKey: 'idem-0000-0002' },
        CONSUMER,
      );

      const results = context.harness.repository<TryOnResult>(TryOnResult).$rows;
      const original = context.storage.objects.get(results[0]?.storageKey ?? '');
      const copied = context.storage.objects.get(results[1]?.storageKey ?? '');

      expect(original).toBeDefined();
      expect(copied?.equals(original as Buffer)).toBe(true);
      expect(first.result?.id).not.toBe(second.result?.id);
    });

    it('copies into the requesting user’s own namespace, never sharing by reference (§3.7)', async () => {
      context = await createTryOnContext();
      await context.tryOn.create(DTO, CONSUMER);

      // A different consumer, byte-identical photo — the cross-user hit §3.7 describes.
      const other = { ...CONSUMER, id: '22222222-2222-4222-8222-222222222222' };
      context.photos.photo = { ...context.photos.photo, userId: other.id };

      const response = await context.tryOn.create(
        { ...DTO, idempotencyKey: 'idem-0000-0003' },
        other,
      );

      expect(response.cacheHit).toBe(true);
      // Hers, under her own prefix — so per-user deletion and `sub`-scoped signed URLs
      // stay correct (C-31, C-38, §3.4).
      expect(response.result?.url).toContain(`renders/${other.id}/`);
      expect(context.quota.charges).toHaveLength(1);
    });

    it('copies the existing thumbnail instead of re-encoding one (PRD §9.1)', async () => {
      context = await createTryOnContext();

      await context.tryOn.create(DTO, CONSUMER);
      context.storage.copy.mockClear();
      context.images.toWebpThumbnail.mockClear();

      const second = await context.tryOn.create(
        { ...DTO, idempotencyKey: 'idem-0000-0002' },
        CONSUMER,
      );

      expect(second.cacheHit).toBe(true);
      // Two file copies — the render and its thumbnail — and no sharp. Re-encoding a
      // full-size PNG is hundreds of milliseconds of CPU on the path §9.1 gives 400 ms to,
      // to produce a file that already exists byte for byte.
      expect(context.storage.copy).toHaveBeenCalledTimes(2);
      expect(context.images.toWebpThumbnail).not.toHaveBeenCalled();

      const results = context.harness.repository<TryOnResult>(TryOnResult).$rows;
      const [original, copied] = results;
      expect(copied?.thumbnailKey).not.toBeNull();
      // Her own object, not a pointer at his: C-31 hard-deletes a result's thumbnail.
      expect(copied?.thumbnailKey).not.toBe(original?.thumbnailKey);
      expect(
        context.storage.objects
          .get(copied?.thumbnailKey ?? '')
          ?.equals(context.storage.objects.get(original?.thumbnailKey ?? '') as Buffer),
      ).toBe(true);
    });

    it('falls back to re-deriving when no thumbnail exists for those bytes', async () => {
      context = await createTryOnContext();

      await context.tryOn.create(DTO, CONSUMER);

      // The source thumbnail went missing — an older row, a failed thumbnail at
      // generation time, a swept file. The grid must still get one.
      const [original] = context.harness.repository<TryOnResult>(TryOnResult).$rows;
      context.storage.objects.delete(original?.thumbnailKey ?? '');
      context.images.toWebpThumbnail.mockClear();

      const second = await context.tryOn.create(
        { ...DTO, idempotencyKey: 'idem-0000-0002' },
        CONSUMER,
      );

      expect(second.cacheHit).toBe(true);
      const results = context.harness.repository<TryOnResult>(TryOnResult).$rows;
      expect(results[1]?.thumbnailKey).not.toBeNull();
      expect(context.images.toWebpThumbnail).toHaveBeenCalledTimes(1);
    });

    it('increments hitCount so the E-13 cache-hit rate is real', async () => {
      context = await createTryOnContext();

      await context.tryOn.create(DTO, CONSUMER);
      await context.tryOn.create({ ...DTO, idempotencyKey: 'idem-0000-0002' }, CONSUMER);

      expect(context.harness.repository<TryOnCache>(TryOnCache).$rows[0]?.hitCount).toBe(1);
    });

    it('misses when the photo changes, so a new photo generates afresh (C-16)', async () => {
      context = await createTryOnContext();

      await context.tryOn.create(DTO, CONSUMER);

      // She replaced her photo: same garment, different `personPhotoHash`.
      context.photos.photo = { ...context.photos.photo, hash: REPLACEMENT_PHOTO_HASH };

      const second = await context.tryOn.create(
        { ...DTO, idempotencyKey: 'idem-0000-0002' },
        CONSUMER,
      );

      expect(second.cacheHit).toBe(false);
      expect(context.quota.charges).toHaveLength(2);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Idempotency (§8.4)
   * ------------------------------------------------------------------------------------ */

  describe('idempotency keys prevent double-click double-charging (§8.4)', () => {
    it('two concurrent identical requests produce one job and one charge', async () => {
      context = await createTryOnContext();
      const jobs = context.harness.repository<TryOnJob>(TryOnJob);
      enforceIdempotencyIndex(jobs);

      const [first, second] = await Promise.allSettled([
        context.tryOn.create(DTO, CONSUMER),
        context.tryOn.create(DTO, CONSUMER),
      ]);

      const outcomes = [first, second];
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({
        errorCode: ErrorCode.IDEMPOTENCY_IN_FLIGHT,
      });

      // The whole point: one row, one charge, one render.
      expect(jobs.$rows).toHaveLength(1);
      expect(context.quota.charges).toHaveLength(1);
      expect(context.harness.repository<TryOnResult>(TryOnResult).$rows).toHaveLength(1);
    });

    it('the refusal names the running job, so the client attaches instead of retrying', async () => {
      context = await createTryOnContext();
      const jobs = context.harness.repository<TryOnJob>(TryOnJob);
      enforceIdempotencyIndex(jobs);

      const [, second] = await Promise.allSettled([
        context.tryOn.create(DTO, CONSUMER),
        context.tryOn.create(DTO, CONSUMER),
      ]);

      expect((second as PromiseRejectedResult).reason).toMatchObject({
        details: { jobId: jobs.$rows[0]?.id },
      });
    });

    it('replays a completed job for a repeated key rather than generating again', async () => {
      context = await createTryOnContext();

      const first = await context.tryOn.create(DTO, CONSUMER);
      const replay = await context.tryOn.create(DTO, CONSUMER);

      expect(replay.jobId).toBe(first.jobId);
      expect(replay.result?.id).toBe(first.result?.id);
      expect(context.quota.charges).toHaveLength(1);
      expect(context.harness.repository<TryOnJob>(TryOnJob).$rows).toHaveLength(1);
    });

    it('lets a failed key be retried — it charged nothing, so a retry is correct', async () => {
      context = await createTryOnContext();
      context.provider.alwaysFail(ErrorCode.UPSTREAM_TIMEOUT);
      await context.tryOn.create(DTO, CONSUMER).catch(() => undefined);

      context.provider.reset();
      const retry = await context.tryOn.create({ ...DTO, idempotencyKey: 'idem-retry' }, CONSUMER);

      expect(retry.status).toBe(JobStatus.SUCCEEDED);
      expect(context.quota.charges).toHaveLength(1);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Preview mode (A-31)
   * ------------------------------------------------------------------------------------ */

  describe('preview mode spends nothing (A-31)', () => {
    it('serves the garment’s approved test render without a job, a charge or an upstream call', async () => {
      context = await createTryOnContext();

      // An admin ran the A-11 test render first; that is what preview mode replays.
      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);
      const chargesAfterTestRender = context.quota.charges.length;
      const jobsAfterTestRender = context.harness.repository<TryOnJob>(TryOnJob).$rows.length;
      const generate = jest.spyOn(context.provider, 'generate');

      context.preview.setPreviewMode(ADMIN.id, true);
      const response = await context.tryOn.create(DTO, ADMIN);

      expect(response.cacheHit).toBe(true);
      expect(response.result).not.toBeNull();

      // Nothing was spent, no new job row was written, and the upstream was never called.
      expect(context.quota.charges).toHaveLength(chargesAfterTestRender);
      expect(context.harness.repository<TryOnJob>(TryOnJob).$rows).toHaveLength(
        jobsAfterTestRender,
      );
      expect(generate).not.toHaveBeenCalled();
    });

    it('is not a way for an admin to generate: with preview off, the chain refuses the role', async () => {
      context = await createTryOnContext();

      await expect(context.tryOn.create(DTO, ADMIN)).rejects.toMatchObject({
        errorCode: ErrorCode.INSUFFICIENT_ROLE,
      });
      expect(context.quota.charges).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * The A-9 source image
   * ------------------------------------------------------------------------------------ */

  it('refuses with TRYON_SOURCE_REQUIRED when the try-on source was deleted after publication', async () => {
    context = await createTryOnContext({ sourceImage: null });

    await expect(context.tryOn.create(DTO, CONSUMER)).rejects.toMatchObject({
      errorCode: ErrorCode.TRYON_SOURCE_REQUIRED,
    });

    // Refused before a job row and before any spend.
    expect(context.harness.repository<TryOnJob>(TryOnJob).$rows).toHaveLength(0);
    expect(context.quota.charges).toHaveLength(0);
  });
});
