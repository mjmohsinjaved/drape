import { ErrorCode } from '@library/common';

import { evaluatePublishAdvisories, hasApprovedTestRender } from '@api/modules/garments';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';
import {
  ADMIN,
  buildTryableGarment,
  CONSUMER,
  createTryOnContext,
  GARMENT_ID,
  REFERENCE_MODEL_ID,
  type TryOnTestContext,
} from '../testing/tryon-harness';

describe('TestRenderService — A-11, A-12, §8.4', () => {
  let context: TryOnTestContext;

  afterEach(async () => {
    await context.close();
  });

  describe('running a test render', () => {
    it('renders against a reference model — never a consumer photo (S-10, §4.15)', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;
      expect(job).toMatchObject({
        origin: JobOrigin.TEST_RENDER,
        isTestRender: true,
        referenceModelId: REFERENCE_MODEL_ID,
        personPhotoId: null,
      });
      expect(context.photos.resolveGenerationPhoto).not.toHaveBeenCalled();
    });

    it('leaves the garment PENDING — rendered is not approved', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({
          testRenderState: TestRenderState.NONE,
          testRenderApprovedAt: null,
        }),
      });

      const response = await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      expect(response.testRenderState).toBe(TestRenderState.PENDING);
      expect(response.publishable).toBe(false);
      expect(response.renderUrl).not.toBeNull();
      expect(response.sourceUrl).not.toBeNull();
    });

    it('stores the render on the garment for the side-by-side approval screen', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      const [garment] = context.harness.repository<Garment>(Garment).$rows;
      const [result] = context.harness.repository<TryOnResult>(TryOnResult).$rows;
      expect(garment?.testRenderId).toBe(result?.id);
      expect(result?.isTestRender).toBe(true);
    });

    it('refuses a garment with no try-on source, rather than discovering it upstream (A-9)', async () => {
      context = await createTryOnContext({ sourceImage: null });

      await expect(context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN)).rejects.toMatchObject(
        { errorCode: ErrorCode.TRYON_SOURCE_REQUIRED },
      );

      expect(context.quota.charges).toHaveLength(0);
    });
  });

  describe('the §8.4 accounting split', () => {
    it('charges platform budget under TEST_RENDER and nobody’s quota', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      expect(context.quota.testRenderCharges).toEqual([
        expect.objectContaining({ origin: 'TEST_RENDER', userId: null, actorId: ADMIN.id }),
      ]);
      expect(context.quota.consumerCharges).toHaveLength(0);
    });

    it('keeps a consumer generation on the consumer side of the split', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);
      await context.testRenders.approve(GARMENT_ID, ADMIN);

      await context.tryOn.create(
        { garmentId: GARMENT_ID, idempotencyKey: 'idem-consumer' },
        CONSUMER,
      );

      expect(context.quota.testRenderCharges).toHaveLength(1);
      expect(context.quota.consumerCharges).toEqual([
        expect.objectContaining({ origin: 'CONSUMER', userId: CONSUMER.id }),
      ]);
    });

    it('keeps test renders out of her results tray and her history', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      const tray = await context.jobs.list(ADMIN, {
        page: 1,
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });
      expect(tray.items).toHaveLength(0);
    });

    it('charges nothing when the test render fails (§8.3)', async () => {
      context = await createTryOnContext();
      context.provider.alwaysFail(ErrorCode.UPSTREAM_NO_GARMENT_DETECTED);

      await expect(context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN)).rejects.toThrow();

      expect(context.quota.charges).toHaveLength(0);
    });
  });

  describe('approval unblocks publishing, and nothing else does (E-10)', () => {
    it('sets both columns, because the publish gate requires the pair', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({
          testRenderState: TestRenderState.NONE,
          testRenderApprovedAt: null,
          publishState: PublishState.DRAFT,
        }),
      });
      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      const response = await context.testRenders.approve(GARMENT_ID, ADMIN);

      const [garment] = context.harness.repository<Garment>(Garment).$rows;
      expect(response.publishable).toBe(true);
      expect(garment?.testRenderState).toBe(TestRenderState.APPROVED);
      expect(garment?.testRenderApprovedAt).toBeInstanceOf(Date);
      expect(garment?.approvedBy).toBe(ADMIN.id);
      expect(hasApprovedTestRender(garment)).toBe(true);
    });

    it('refuses to approve a garment that has never been rendered', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({
          testRenderId: null,
          testRenderState: TestRenderState.NONE,
          testRenderApprovedAt: null,
        }),
      });

      await expect(context.testRenders.approve(GARMENT_ID, ADMIN)).rejects.toMatchObject({
        errorCode: ErrorCode.TEST_RENDER_REQUIRED,
      });
    });

    it('rejection leaves the piece unpublishable, and the publish gate agrees', async () => {
      context = await createTryOnContext();
      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      const response = await context.testRenders.reject(
        GARMENT_ID,
        { reason: 'Drape falls wrong at the shoulder.' },
        ADMIN,
      );

      const [garment] = context.harness.repository<Garment>(Garment).$rows;
      expect(response.testRenderState).toBe(TestRenderState.REJECTED);
      expect(response.publishable).toBe(false);
      expect(
        evaluatePublishAdvisories({
          garment: garment,
          hasTryOnSource: true,
          minQualityScore: 60,
        }),
      ).toEqual([ErrorCode.TEST_RENDER_REQUIRED]);
    });

    it('a rendered-but-unapproved garment can still be tried on by a consumer', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({
          testRenderState: TestRenderState.NONE,
          testRenderApprovedAt: null,
        }),
      });
      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      await expect(
        context.tryOn.create(
          { garmentId: GARMENT_ID, idempotencyKey: 'idem-unapproved' },
          CONSUMER,
        ),
      ).resolves.toMatchObject({ jobId: expect.any(String) });
    });

    it('re-rendering an approved garment sends it back to PENDING', async () => {
      context = await createTryOnContext();

      const response = await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      expect(response.testRenderState).toBe(TestRenderState.PENDING);
      expect(response.publishable).toBe(false);
    });
  });

  describe('bulk test renders (A-12, §8.2)', () => {
    it('queues rows rather than running them, so the request returns immediately', async () => {
      context = await createTryOnContext();

      const { batchId } = await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

      const rows = context.harness.repository<TryOnJob>(TryOnJob).$rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: JobStatus.QUEUED,
        origin: JobOrigin.TEST_RENDER,
        batchId,
      });
      expect(context.quota.charges).toHaveLength(0);
    });

    it('reports per-item progress and a summary (D-16)', async () => {
      context = await createTryOnContext();
      const { batchId } = await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

      const batch = await context.testRenders.batch(batchId);

      expect(batch).toMatchObject({ batchId, total: 1, succeeded: 0, failed: 0, pending: 1 });
      expect(batch.items[0]?.garmentId).toBe(GARMENT_ID);
    });

    it('estimates the cost before it runs, excluding already-approved pieces (A-12)', async () => {
      context = await createTryOnContext();

      const estimate = await context.testRenders.estimate({ garmentIds: [GARMENT_ID] });

      expect(estimate).toMatchObject({
        selected: 1,
        alreadyApproved: 1,
        generations: 0,
        withinBudget: true,
      });
    });

    it('counts a garment with no approved render as a generation, and compares to the budget', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({
          testRenderState: TestRenderState.NONE,
          testRenderApprovedAt: null,
        }),
      });
      context.quota.budgetUsed = context.quota.budgetLimit;

      const estimate = await context.testRenders.estimate({ garmentIds: [GARMENT_ID] });

      expect(estimate).toMatchObject({ generations: 1, budgetRemaining: 0, withinBudget: false });
    });

    it('reports an unknown batch as JOB_NOT_FOUND', async () => {
      context = await createTryOnContext();

      await expect(
        context.testRenders.batch('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
      ).rejects.toMatchObject({ errorCode: ErrorCode.JOB_NOT_FOUND });
    });
  });
});
