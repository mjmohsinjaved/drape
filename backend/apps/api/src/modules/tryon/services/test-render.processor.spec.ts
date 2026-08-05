import { ErrorCode } from '@library/common';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';

import { TryOnConfig } from '../config/tryon.config';
import { TryOnJob } from '../entities/tryon-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import {
  ADMIN,
  createTryOnContext,
  GARMENT_ID,
  type TryOnTestContext,
} from '../testing/tryon-harness';

import { TestRenderProcessor } from './test-render.processor';
import { TestRenderService } from './test-render.service';

/**
 * **PRD §8.2 — "Admin bulk test renders run through a NestJS task processor at
 * concurrency one, so catalog work never competes with a live consumer generation."**
 *
 * A consumer is waiting seven seconds for her render (C-19) while an admin queues fifty
 * catalogue renders against the same upstream and the same monthly budget. The
 * consumer has to win, and concurrency one is how. So the ceiling is asserted directly:
 * a second tick arriving while the first is still working must find the door shut.
 */
describe('TestRenderProcessor — §8.2, concurrency one', () => {
  let context: TryOnTestContext;
  let processor: TestRenderProcessor;

  function buildProcessor(): void {
    processor = new TestRenderProcessor(
      context.harness.repository<TryOnJob>(TryOnJob),
      context.harness.get<TestRenderService>(TestRenderService),
      context.harness.get<TryOnConfig>(TryOnConfig),
    );
  }

  afterEach(async () => {
    await context.close();
  });

  it('claims one queued batch render and runs it to completion', async () => {
    context = await createTryOnContext();
    buildProcessor();
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

    await processor.drainOnce();

    const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;
    expect(job?.status).toBe(JobStatus.SUCCEEDED);
    expect(context.quota.testRenderCharges).toHaveLength(1);
  });

  it('adopts the queued row rather than writing a second job', async () => {
    context = await createTryOnContext();
    buildProcessor();
    const { batchId } = await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

    await processor.drainOnce();

    // One row per batch item, from queue to completion — the batch's progress is a
    // query on `batchId`, not a process-local list.
    const rows = context.harness.repository<TryOnJob>(TryOnJob).$rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.batchId).toBe(batchId);
  });

  it('runs one at a time: a tick arriving mid-render does nothing', async () => {
    context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 60 } });
    buildProcessor();
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

    const first = processor.drainOnce();
    // Let the first tick claim its job — it is the `active` counter, not the timer,
    // that enforces the ceiling, and it is incremented once the job is claimed.
    await new Promise((resolve) => setImmediate(resolve));
    expect(processor.activeCount).toBe(1);

    const jobs = context.harness.repository<TryOnJob>(TryOnJob);
    const lookupsBefore = (jobs.findOne as unknown as jest.Mock).mock.calls.length;

    // The second tick fires while the first is still holding the upstream call open.
    await processor.drainOnce();

    // It returned without so much as looking for work.
    expect((jobs.findOne as unknown as jest.Mock).mock.calls.length).toBe(lookupsBefore);
    expect(processor.activeCount).toBe(1);

    await first;

    expect(processor.activeCount).toBe(0);
    // Exactly one charge: the second tick was refused by the ceiling, not queued behind it.
    expect(context.quota.charges).toHaveLength(1);
  });

  it('does nothing when the queue is empty', async () => {
    context = await createTryOnContext();
    buildProcessor();

    await expect(processor.drainOnce()).resolves.toBeUndefined();
    expect(context.quota.charges).toHaveLength(0);
  });

  it('ignores a single interactive test render — only batch work is drained', async () => {
    context = await createTryOnContext();
    buildProcessor();
    await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);
    const chargesAfterRun = context.quota.charges.length;

    await processor.drainOnce();

    // The interactive render already finished inline on the admin's request; the
    // processor must not pick it up and charge for it twice.
    expect(context.quota.charges).toHaveLength(chargesAfterRun);
  });

  /* -----------------------------------------------------------------------------------------
   * A-12 — a batch that costs money has to move the garments it paid for
   * -------------------------------------------------------------------------------------- */

  it('advances the garment to PENDING, so the render it paid for can be approved', async () => {
    context = await createTryOnContext();
    buildProcessor();
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

    await processor.drainOnce();

    // The processor used to call `TryOnRunnerService.run()` directly, which produces and
    // charges for a render and writes neither of these columns. Fifty queued garments
    // came back fully charged and every one of them still unpublishable.
    const garment = context.harness.repository<Garment>(Garment).$rows[0];
    expect(garment?.testRenderState).toBe(TestRenderState.PENDING);
    expect(garment?.testRenderId).not.toBeNull();

    // And the A-11 gate now opens, which is the thing the budget was spent for.
    await expect(context.testRenders.approve(GARMENT_ID, ADMIN)).resolves.toMatchObject({
      testRenderState: TestRenderState.APPROVED,
      publishable: true,
    });
  });

  it('leaves a failed item at its previous state — nothing to approve', async () => {
    context = await createTryOnContext();
    buildProcessor();
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);
    context.provider.alwaysFail(ErrorCode.UPSTREAM_NO_GARMENT_DETECTED);

    await processor.drainOnce();

    const garment = context.harness.repository<Garment>(Garment).$rows[0];
    expect(garment?.testRenderId).toBeNull();
  });

  /* -----------------------------------------------------------------------------------------
   * §8.2 — the claim, not just the counter
   * -------------------------------------------------------------------------------------- */

  it('two ticks racing on one queued row adopt it once, and the platform pays once', async () => {
    context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 20 } });
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

    // Two *independent* processors — the in-process `active` counter cannot see across
    // them, which is exactly the situation the row claim has to survive. (One process
    // today, §8.2; the conditional update is what makes that an operational fact rather
    // than a correctness assumption.)
    const jobs = context.harness.repository<TryOnJob>(TryOnJob);
    const service = context.harness.get<TestRenderService>(TestRenderService);
    const config = context.harness.get<TryOnConfig>(TryOnConfig);
    const first = new TestRenderProcessor(jobs, service, config);
    const second = new TestRenderProcessor(jobs, service, config);

    await Promise.all([first.drainOnce(), second.drainOnce()]);

    // `adoptJob` re-asserts `status = QUEUED` and checks `affected`, so the loser adopts
    // nothing. Without that predicate both ticks ran the same row and the budget was
    // charged twice for one catalogue render.
    expect(context.quota.charges).toHaveLength(1);
    expect(jobs.$rows).toHaveLength(1);
    expect(jobs.$rows[0]?.status).toBe(JobStatus.SUCCEEDED);
  });

  it('holds the concurrency slot from the moment it is claimed, not after the read', async () => {
    context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 20 } });
    buildProcessor();
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

    // No `await` between the two calls: this is two timer ticks landing in the same turn
    // of the event loop, which is the only way the ceiling can be beaten from inside one
    // process. The counter used to be incremented *after* the awaited `findOne`, so both
    // ticks passed the comparison and both went looking for work.
    const both = Promise.all([processor.drainOnce(), processor.drainOnce()]);
    expect(processor.activeCount).toBe(1);

    await both;

    expect(context.quota.charges).toHaveLength(1);
    expect(processor.activeCount).toBe(0);
  });

  it('carries on after a failed item rather than stalling the batch', async () => {
    context = await createTryOnContext();
    buildProcessor();
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);
    context.provider.alwaysFail(ErrorCode.UPSTREAM_NO_GARMENT_DETECTED);

    // One bad garment must not be able to hold up forty-nine good ones.
    await expect(processor.drainOnce()).resolves.toBeUndefined();

    const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;
    expect(job?.status).toBe(JobStatus.FAILED);
    expect(context.quota.charges).toHaveLength(0);
    expect(processor.activeCount).toBe(0);
  });
});
