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

/**
 * **The A-11 test-render gate, and the §8.4 accounting split.**
 *
 * > A-11: "No garment reaches the consumer catalog without an approved test render."
 * > E-10: "A test asserts that no garment lacking an approved test render can appear in
 * > the consumer catalog."
 *
 * Two properties, and they pull in opposite directions, which is why both are here:
 * the gate has to be **impossible to bypass** (a rendered garment is not an approved
 * one, and an approved one needs both columns), and admin catalogue work has to be
 * **invisible to consumer demand** (§8.4) — budget under `TEST_RENDER`, nobody's quota.
 */
describe('TestRenderService — A-11, A-12, §8.4', () => {
  let context: TryOnTestContext;

  afterEach(async () => {
    await context.close();
  });

  /* ---------------------------------------------------------------------------------------
   * Running one (A-11)
   * ------------------------------------------------------------------------------------ */

  describe('running a test render', () => {
    it('renders against a reference model — never a consumer photo (S-10, §4.15)', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;
      expect(job).toMatchObject({
        origin: JobOrigin.TEST_RENDER,
        isTestRender: true,
        referenceModelId: REFERENCE_MODEL_ID,
        // The column that would hold a consumer photo is null, and there is no code
        // path in this service that could set it.
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

  /* ---------------------------------------------------------------------------------------
   * §8.4 — admin work is tracked separately from consumer demand
   * ------------------------------------------------------------------------------------ */

  describe('the §8.4 accounting split', () => {
    it('charges platform budget under TEST_RENDER and nobody’s quota', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      expect(context.quota.testRenderCharges).toEqual([
        expect.objectContaining({ origin: 'TEST_RENDER', userId: null, actorId: ADMIN.id }),
      ]);
      // A-33 splits the burn-rate chart on exactly this: no consumer quota moved.
      expect(context.quota.consumerCharges).toHaveLength(0);
    });

    it('keeps a consumer generation on the consumer side of the split', async () => {
      context = await createTryOnContext();

      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);
      // Rendering sends the piece back to PENDING, so the consumer path is closed until
      // an admin approves — which is the gate, working.
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

  /* ---------------------------------------------------------------------------------------
   * Approval — the gate itself (A-11, E-10)
   * ------------------------------------------------------------------------------------ */

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
      // The same function the garments module uses at publish time. It reports rather
      // than refuses now, so this asserts the advisory is raised, not that publish fails.
      expect(
        evaluatePublishAdvisories({
          garment: garment,
          hasTryOnSource: true,
          minQualityScore: 60,
        }),
      ).toEqual([ErrorCode.TEST_RENDER_REQUIRED]);
    });

    it('a rendered-but-unapproved garment cannot be tried on by a consumer (E-10)', async () => {
      context = await createTryOnContext({
        garment: buildTryableGarment({
          testRenderState: TestRenderState.NONE,
          testRenderApprovedAt: null,
        }),
      });
      await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      // Published, rendered, and still refused — because it is not *approved*.
      await expect(
        context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-e10' }, CONSUMER),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TEST_RENDER_REQUIRED });

      expect(context.quota.consumerCharges).toHaveLength(0);
    });

    it('re-rendering an approved garment sends it back to PENDING', async () => {
      context = await createTryOnContext();

      // The stored render changed, so the approval that described the old one no longer
      // means anything.
      const response = await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);

      expect(response.testRenderState).toBe(TestRenderState.PENDING);
      expect(response.publishable).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * Bulk (A-12, §8.2)
   * ------------------------------------------------------------------------------------ */

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
      // Nothing has been spent yet — the processor does that, one at a time.
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

      // The fixture garment already carries an approved render, so re-rendering it
      // would spend budget to learn nothing.
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
