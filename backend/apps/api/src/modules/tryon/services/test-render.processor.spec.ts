import { ErrorCode } from '@library/common';

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
import { TryOnRunnerService } from './tryon-runner.service';

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

  async function buildProcessor(): Promise<void> {
    processor = new TestRenderProcessor(
      context.harness.repository<TryOnJob>(TryOnJob),
      context.harness.get<TestRenderService>(TestRenderService),
      context.harness.get<TryOnRunnerService>(TryOnRunnerService),
      context.harness.get<TryOnConfig>(TryOnConfig),
    );
  }

  afterEach(async () => {
    await context.close();
  });

  it('claims one queued batch render and runs it to completion', async () => {
    context = await createTryOnContext();
    await buildProcessor();
    await context.testRenders.queueBulk({ garmentIds: [GARMENT_ID] }, ADMIN);

    await processor.drainOnce();

    const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;
    expect(job?.status).toBe(JobStatus.SUCCEEDED);
    expect(context.quota.testRenderCharges).toHaveLength(1);
  });

  it('adopts the queued row rather than writing a second job', async () => {
    context = await createTryOnContext();
    await buildProcessor();
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
    await buildProcessor();
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
    await buildProcessor();

    await expect(processor.drainOnce()).resolves.toBeUndefined();
    expect(context.quota.charges).toHaveLength(0);
  });

  it('ignores a single interactive test render — only batch work is drained', async () => {
    context = await createTryOnContext();
    await buildProcessor();
    await context.testRenders.run({ garmentId: GARMENT_ID }, ADMIN);
    const chargesAfterRun = context.quota.charges.length;

    await processor.drainOnce();

    // The interactive render already finished inline on the admin's request; the
    // processor must not pick it up and charge for it twice.
    expect(context.quota.charges).toHaveLength(chargesAfterRun);
  });

  it('carries on after a failed item rather than stalling the batch', async () => {
    context = await createTryOnContext();
    await buildProcessor();
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
