import { ErrorCode, QuotaException } from '@library/common';

import { PhotoModerationState } from '@api/modules/person-photos';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobStatus } from '../enums/job-status.enum';
import {
  CONSUMER,
  CONSUMER_ID,
  createTryOnContext,
  GARMENT_ID,
  PHOTO_ID,
  type TryOnTestContext,
} from '../testing/tryon-harness';

/**
 * **`TryOnRunnerService` — the terminal writes, and the money that hangs off them.**
 *
 * Everything here is a race or a repeat: the cases where the job row moves under the
 * generation, or the same idempotency key arrives twice. They were invisible to the suite
 * for one structural reason, now fixed in the fixtures rather than worked around here:
 *
 *  - the in-memory repository did not model `UQ_tryon_jobs_idem`, so **every** idempotency
 *    test was asserting against a second insert that quietly succeeded. The harness now
 *    declares the index and the double raises a real `23505`;
 *  - the existing cancellation test seeded an orphan `RUNNING` row with no runner in
 *    flight, so `charges` was trivially empty. Here the cancel lands *while* the upstream
 *    call is open, which is the only arrangement that can catch the bug.
 */
describe('TryOnRunnerService — cancellation, replay and the order of the spend', () => {
  let context: TryOnTestContext;

  afterEach(async () => {
    await context.close();
  });

  const startGeneration = (idempotencyKey = 'key-1'): Promise<unknown> =>
    context.tryOn.create(
      { garmentId: GARMENT_ID, personPhotoId: PHOTO_ID, idempotencyKey },
      CONSUMER,
    );

  const jobRows = (): TryOnJob[] => context.harness.repository<TryOnJob>(TryOnJob).$rows;
  const resultRows = (): TryOnResult[] =>
    context.harness.repository<TryOnResult>(TryOnResult).$rows;

  /** Waits until the runner has written its `RUNNING` row and gone upstream. */
  const untilRunning = async (): Promise<TryOnJob> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const running = jobRows().find((job) => job.status === JobStatus.RUNNING);
      if (running !== undefined) {
        return running;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('The runner never reached RUNNING.');
  };

  /* -----------------------------------------------------------------------------------------
   * CRITICAL — a cancelled try-on is not charged
   * -------------------------------------------------------------------------------------- */

  describe('cancellation while the upstream call is in flight (§5.11)', () => {
    it('charges nothing when she cancels mid-generation', async () => {
      // Long enough that the cancel genuinely lands inside the upstream call.
      context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 80 } });

      const generation = startGeneration();
      const running = await untilRunning();

      await context.jobs.cancel(CONSUMER, running.id);

      await expect(generation).rejects.toBeDefined();

      // `cancel()` told her it cost nothing. Before the status predicate on
      // `markSucceeded`, the runner came back at t+7s, overwrote CANCELLED → SUCCEEDED
      // and charged her quota *and* the platform budget for it.
      expect(context.quota.charges).toHaveLength(0);
      expect(context.quota.consumerCharges).toHaveLength(0);
    });

    it('leaves the job CANCELLED — the runner does not overwrite her decision', async () => {
      context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 80 } });

      const generation = startGeneration();
      const running = await untilRunning();
      await context.jobs.cancel(CONSUMER, running.id);
      await expect(generation).rejects.toBeDefined();

      const job = jobRows().find((row) => row.id === running.id);
      expect(job?.status).toBe(JobStatus.CANCELLED);
    });

    it('leaves no downloadable render behind for a generation nobody paid for', async () => {
      context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 80 } });

      const generation = startGeneration();
      const running = await untilRunning();
      await context.jobs.cancel(CONSUMER, running.id);
      await expect(generation).rejects.toBeDefined();

      // Withdrawn, not hard-deleted: the bytes are still named by a row the §3.5 orphan
      // sweep can reason about, and nothing live points at them.
      const live = resultRows().filter((row) => row.deletedAt === null);
      expect(live).toHaveLength(0);
    });

    it('a failure arriving after a cancel does not rewrite the row either', async () => {
      context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 80 } });
      context.provider.alwaysFail(ErrorCode.UPSTREAM_TIMEOUT);

      const generation = startGeneration();
      const running = await untilRunning();
      await context.jobs.cancel(CONSUMER, running.id);
      await expect(generation).rejects.toBeDefined();

      const job = jobRows().find((row) => row.id === running.id);
      expect(job?.status).toBe(JobStatus.CANCELLED);
      expect(job?.errorCode).toBeNull();
    });
  });

  /* -----------------------------------------------------------------------------------------
   * HIGH — a live render under a FAILED job with no charge
   * -------------------------------------------------------------------------------------- */

  describe('a charge that refuses after the render exists', () => {
    it('leaves nothing downloadable when the quota refuses at the last moment', async () => {
      context = await createTryOnContext();
      // The guard chain passes — this is the second of two racers, whose SERIALIZABLE
      // retry re-derives zero inside `consumeWithin`.
      context.quota.chargeFailsWith = new QuotaException(ErrorCode.QUOTA_EXHAUSTED);

      await expect(startGeneration()).rejects.toMatchObject({
        errorCode: ErrorCode.QUOTA_EXHAUSTED,
      });

      // The whole finding: she used to keep a live, downloadable render with no ledger
      // row against it, under a job the failure path had rewritten to FAILED.
      expect(resultRows().filter((row) => row.deletedAt === null)).toHaveLength(0);
      expect(jobRows()[0]?.status).toBe(JobStatus.FAILED);
      expect(context.quota.charges).toHaveLength(0);
    });

    it('reverses a charge that committed before a later step failed', async () => {
      context = await createTryOnContext();

      // The charge lands, then writing the result row blows up — the one window
      // `releaseOnFailure` was written for and was never called from.
      const results = context.harness.repository<TryOnResult>(TryOnResult);
      results.save = jest.fn(async () => {
        throw new Error('the results table went away');
      });

      await expect(startGeneration()).rejects.toBeDefined();

      expect(context.quota.releases).toHaveLength(1);
      expect(context.quota.releases[0]?.userId).toBe(CONSUMER_ID);
      // Reversed, so the ledger nets to nothing for a render she never received.
      expect(context.quota.charges).toHaveLength(0);
    });

    it('calls the release on every failure — it is a no-op when nothing was charged', async () => {
      context = await createTryOnContext();
      context.provider.alwaysFail(ErrorCode.UPSTREAM_NO_GARMENT_DETECTED);

      await expect(startGeneration()).rejects.toBeDefined();

      expect(context.quota.releases).toHaveLength(1);
      expect(context.quota.charges).toHaveLength(0);
    });
  });

  /* -----------------------------------------------------------------------------------------
   * HIGH — the documented idempotency retry path
   * -------------------------------------------------------------------------------------- */

  describe('idempotency (§8.4), against a modelled unique index', () => {
    it('lets a FAILED key be retried — the path §8.3 documents and could not reach', async () => {
      context = await createTryOnContext();
      context.provider.alwaysFail(ErrorCode.UPSTREAM_TIMEOUT);

      await expect(startGeneration('retry-me')).rejects.toBeDefined();

      // The retry §8.3 tells a client to make. It used to come back as a permanent 409
      // pointing at the failed job, and §2.4 then had the client attach to a stream that
      // would never emit.
      context.provider.reset();
      await expect(startGeneration('retry-me')).resolves.toMatchObject({
        status: JobStatus.SUCCEEDED,
      });

      // The old row still exists for E-13 — it is soft-deleted, not destroyed — and the
      // key now belongs to the run that succeeded.
      const rows = context.harness.repository<TryOnJob>(TryOnJob).$rows;
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.deletedAt != null)).toHaveLength(1);
      expect(context.quota.consumerCharges).toHaveLength(1);
    });

    it('lets a CANCELLED key be retried for the same reason', async () => {
      context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 80 } });

      const generation = startGeneration('cancel-me');
      const running = await untilRunning();
      await context.jobs.cancel(CONSUMER, running.id);
      await expect(generation).rejects.toBeDefined();

      context = Object.assign(context, {});
      await expect(startGeneration('cancel-me')).resolves.toMatchObject({
        status: JobStatus.SUCCEEDED,
      });
    });

    it('replays a SUCCEEDED key instead of regenerating or refusing', async () => {
      context = await createTryOnContext();

      const first = (await startGeneration('once')) as { resultId: string | null };
      const chargesAfterFirst = context.quota.charges.length;

      const second = (await startGeneration('once')) as { resultId: string | null };

      expect(second.resultId).toBe(first.resultId);
      // One key, one generation, one charge — whatever the client does.
      expect(context.quota.charges).toHaveLength(chargesAfterFirst);
      expect(jobRows()).toHaveLength(1);
    });

    it('still refuses a key that is genuinely in flight, naming the job to attach to', async () => {
      context = await createTryOnContext({ env: { TRYON_MOCK_LATENCY_MS: 60 } });

      const first = startGeneration('in-flight');
      await untilRunning();

      await expect(startGeneration('in-flight')).rejects.toMatchObject({
        errorCode: ErrorCode.IDEMPOTENCY_IN_FLIGHT,
      });

      await first;
    });
  });

  /* -----------------------------------------------------------------------------------------
   * §8.3 behaviours that were declared and never read
   * -------------------------------------------------------------------------------------- */

  describe('the failure taxonomy, applied rather than declared', () => {
    it('files an upstream moderation rejection for review and blocks the photo (M1)', async () => {
      context = await createTryOnContext();
      context.provider.alwaysFail(ErrorCode.MODERATION_REJECTED);

      await expect(startGeneration()).rejects.toBeDefined();

      // `queueModeration: true` sat in the policy table unread, so A-34's queue was fed by
      // nothing and the same photograph failed upstream again, at cost, on every retry.
      expect(context.moderation.queued).toHaveLength(1);
      expect(context.moderation.queued[0]).toMatchObject({
        personPhotoId: PHOTO_ID,
        userId: CONSUMER_ID,
        reasonCode: ErrorCode.MODERATION_REJECTED,
      });
    });

    it('does not queue a test render for moderation — no consumer, no photograph', async () => {
      context = await createTryOnContext();
      context.provider.alwaysFail(ErrorCode.MODERATION_REJECTED);

      await expect(
        context.testRenders.run({ garmentId: GARMENT_ID }, { ...CONSUMER, id: CONSUMER_ID }),
      ).rejects.toBeDefined();

      expect(context.moderation.queued[0]?.personPhotoId).toBeNull();
    });

    /**
     * **The `surfacedToConsumer: false` branch, and why the SSE stream cannot hang on it.**
     *
     * `UPSTREAM_RATE_LIMITED` is the one code §2.4 marks "never surfaced", and the concern
     * is obvious: a failure that publishes nothing leaves the stream open and the D-5 error
     * state unrendered. It cannot happen, and the reason is one layer down —
     * `runWithRetry`'s `terminalCodeFor()` maps an exhausted rate limit to
     * `UPSTREAM_UNAVAILABLE` before any provider rejects, precisely so "a job that
     * exhausted its retries on rate limiting … never [fails as] a code §2.4 says is never
     * surfaced". While the backoff is running the job really is still `RUNNING` and the
     * stream really should stay open, which is what the flag is about.
     *
     * So the flag is unreachable from the provider path, and `fail()` now publishes on both
     * branches anyway — an unreachable hang is one refactor away from a reachable one.
     */
    it('closes the stream when the upstream rate limit is exhausted (M4)', async () => {
      context = await createTryOnContext();
      const published = jest.spyOn(context.events, 'publishFailed');
      context.provider.alwaysFail(ErrorCode.UPSTREAM_RATE_LIMITED);

      await expect(startGeneration()).rejects.toBeDefined();

      expect(jobRows()[0]?.status).toBe(JobStatus.FAILED);
      // Mapped by the retry layer, so the consumer is never shown the rate-limit code…
      expect(jobRows()[0]?.errorCode).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
      // …and the stream is closed, so the D-5 error state renders.
      expect(published).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: ErrorCode.UPSTREAM_UNAVAILABLE }),
      );
    });

    it('publishes a terminal event even for a code marked "never surfaced"', async () => {
      context = await createTryOnContext();
      const published = jest.spyOn(context.events, 'publishFailed');

      // Reached directly, because the retry layer makes it unreachable through a provider.
      // The assertion is that no §8.3 branch can leave a consumer watching a spinner.
      const runner = context.runner as unknown as {
        fail(
          request: unknown,
          job: { id: string; startedAt: Date | null },
          error: unknown,
          elapsedMs: number,
        ): Promise<unknown>;
      };

      await runner.fail(
        {
          userId: CONSUMER_ID,
          origin: 'CONSUMER',
          garment: { id: GARMENT_ID },
          personPhotoId: null,
        },
        { id: '33333333-3333-4333-8333-cccccccccccc', startedAt: new Date() },
        new (class extends Error {
          readonly errorCode = ErrorCode.UPSTREAM_RATE_LIMITED;
        })('rate limited'),
        10,
      );

      expect(published).toHaveBeenCalledTimes(1);
    });
  });

  /* -----------------------------------------------------------------------------------------
   * The fixtures themselves — a double that cannot see the bug proves nothing
   * -------------------------------------------------------------------------------------- */

  it('the job repository actually enforces UQ_tryon_jobs_idem', async () => {
    context = await createTryOnContext();
    const jobs = context.harness.repository<TryOnJob>(TryOnJob);

    const row = (id: string): TryOnJob =>
      Object.assign(new TryOnJob(), {
        id,
        userId: CONSUMER_ID,
        idempotencyKey: 'same',
        status: JobStatus.RUNNING,
        deletedAt: null,
      });

    await jobs.save(row('11111111-1111-4111-8111-aaaaaaaaaaaa'));

    await expect(jobs.save(row('22222222-2222-4222-8222-bbbbbbbbbbbb'))).rejects.toMatchObject({
      code: '23505',
    });

    // …and soft-deleting the holder releases the key, which is what
    // `WHERE "deletedAt" IS NULL` on the index exists to permit.
    await jobs.softDelete({ id: '11111111-1111-4111-8111-aaaaaaaaaaaa' });
    await expect(jobs.save(row('22222222-2222-4222-8222-bbbbbbbbbbbb'))).resolves.toBeDefined();
  });

  it('a blocked photo is refused by the guard chain, so a queued rejection ends the loop', async () => {
    context = await createTryOnContext();
    context.photos.photo = {
      ...context.photos.photo,
      moderationState: PhotoModerationState.BLOCKED,
    };

    await expect(startGeneration()).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_BLOCKED_BY_MODERATION,
    });
    expect(context.quota.charges).toHaveLength(0);
  });
});
