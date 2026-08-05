import { ErrorCode } from '@library/common';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import {
  CONSUMER,
  createTryOnContext,
  GARMENT_ID,
  OTHER_CONSUMER_ID,
  type TryOnTestContext,
} from '../testing/tryon-harness';

import type { TryOnJobQueryDto } from '../dto/tryon-job-query.dto';

const QUERY: TryOnJobQueryDto = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'DESC' };

/**
 * The results tray, the polling fallback and cancellation — §5.11, C-19.
 *
 * The polling endpoint matters more than it looks: §5.11 calls it the SSE fallback, and
 * it is what a client behind a buffering proxy, or one reconnecting long after the
 * terminal event aged out of memory, actually uses. It reads the row, so it is correct
 * however long ago the job finished.
 */
describe('TryOnJobsService', () => {
  let context: TryOnTestContext;

  afterEach(async () => {
    await context.close();
  });

  it('lists her recent jobs with their results (C-19 tray)', async () => {
    context = await createTryOnContext();
    await context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-1' }, CONSUMER);

    const page = await context.jobs.list(CONSUMER, QUERY);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ status: JobStatus.SUCCEEDED, cacheHit: false });
    expect(page.items[0]?.result).not.toBeNull();
  });

  it('never lists another account’s jobs', async () => {
    context = await createTryOnContext();
    await context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-1' }, CONSUMER);

    const page = await context.jobs.list({ ...CONSUMER, id: OTHER_CONSUMER_ID }, QUERY);

    expect(page.items).toHaveLength(0);
  });

  it('polls one job and reports the §8.3 consumer copy for a failure', async () => {
    context = await createTryOnContext();
    context.provider.alwaysFail(ErrorCode.UPSTREAM_TIMEOUT);
    await context.tryOn
      .create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-1' }, CONSUMER)
      .catch(() => undefined);

    const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;
    const polled = await context.jobs.findOne(CONSUMER, job?.id ?? '');

    expect(polled).toMatchObject({
      status: JobStatus.FAILED,
      errorCode: ErrorCode.UPSTREAM_TIMEOUT,
      message: 'Taking longer than usual — hang tight.',
    });
  });

  it('throws the true JOB_NOT_OWNED for another account’s job, which the filter masks', async () => {
    context = await createTryOnContext();
    await context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-1' }, CONSUMER);
    const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;

    await expect(
      context.jobs.findOne({ ...CONSUMER, id: OTHER_CONSUMER_ID }, job?.id ?? ''),
    ).rejects.toMatchObject({ errorCode: ErrorCode.JOB_NOT_OWNED });
  });

  it('refuses to open a stream for a job that is not hers, before opening anything', async () => {
    context = await createTryOnContext();
    await context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-1' }, CONSUMER);
    const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;

    await expect(
      context.jobs.streamFor({ ...CONSUMER, id: OTHER_CONSUMER_ID }, job?.id ?? ''),
    ).rejects.toMatchObject({ errorCode: ErrorCode.JOB_NOT_OWNED });
    expect(context.events.activeStreamCount).toBe(0);
  });

  it('cancels a running job and charges nothing either way (§5.11)', async () => {
    context = await createTryOnContext();
    const jobs = context.harness.repository<TryOnJob>(TryOnJob);
    jobs.$seed([
      Object.assign(new TryOnJob(), {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: CONSUMER.id,
        idempotencyKey: 'idem-running',
        status: JobStatus.RUNNING,
        isTestRender: false,
        cacheHit: false,
        attempts: 0,
        startedAt: new Date(),
        deletedAt: null,
      }),
    ]);

    const cancelled = await context.jobs.cancel(CONSUMER, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(cancelled.status).toBe(JobStatus.CANCELLED);
    // Quota is only ever charged from the SUCCEEDED branch, so cancelling costs
    // nothing by construction rather than by refund.
    expect(context.quota.charges).toHaveLength(0);
  });

  it('leaves a finished job alone when cancel arrives late', async () => {
    context = await createTryOnContext();
    await context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-1' }, CONSUMER);
    const [job] = context.harness.repository<TryOnJob>(TryOnJob).$rows;

    const cancelled = await context.jobs.cancel(CONSUMER, job?.id ?? '');

    expect(cancelled.status).toBe(JobStatus.SUCCEEDED);
  });
});
