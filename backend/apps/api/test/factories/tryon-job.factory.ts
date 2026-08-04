import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { JobOrigin } from '@api/modules/tryon/enums/job-origin.enum';
import { JobStatus } from '@api/modules/tryon/enums/job-status.enum';

import { FIXED_NOW } from '../setup/time';

import { buildEntity, hash64, nextSequence, uuid } from './factory.support';

/**
 * `tryon_jobs` (§4.17).
 *
 * The default is a **queued consumer job**. Note the invariants the entity encodes and this
 * factory respects:
 *
 *  - `isTestRender` always equals `origin === TEST_RENDER`. It is kept because PRD §12 lists
 *    it, not because it is a second source of truth.
 *  - A consumer job carries `personPhotoId`; a test render carries `referenceModelId`
 *    instead. A consumer photo is never used for a test render (S-10, §4.15).
 *  - `idempotencyKey` is client-supplied and unique per `(userId, idempotencyKey)` — that
 *    unique index *is* the idempotency mechanism (§8.1 step 1).
 */
export function buildTryOnJob(overrides: Partial<TryOnJob> = {}): TryOnJob {
  const sequence = nextSequence();

  return buildEntity<TryOnJob>(
    TryOnJob,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      userId: uuid(),
      garmentId: uuid(),
      personPhotoId: uuid(),
      referenceModelId: null,

      origin: JobOrigin.CONSUMER,
      isTestRender: false,
      idempotencyKey: `test-idempotency-${sequence}`,

      status: JobStatus.QUEUED,
      cacheHit: false,
      cacheKey: null,
      errorCode: null,
      attempts: 0,
      batchId: null,

      startedAt: null,
      finishedAt: null,
      durationMs: null,
    },
    overrides,
  );
}

/** A job that completed. `durationMs` feeds the `tryon.latency_ms` metric (E-13). */
export function buildSucceededTryOnJob(overrides: Partial<TryOnJob> = {}): TryOnJob {
  const sequence = nextSequence();

  return buildTryOnJob({
    status: JobStatus.SUCCEEDED,
    attempts: 1,
    cacheKey: hash64(`cache-${sequence}`),
    startedAt: FIXED_NOW,
    finishedAt: new Date(FIXED_NOW.getTime() + 7_400),
    durationMs: 7_400,
    ...overrides,
  });
}

/**
 * A failed job. `errorCode` holds an `ErrorCode` value — pass the real one for the branch of
 * the §8.3 failure taxonomy under test (E-6).
 */
export function buildFailedTryOnJob(
  errorCode: string,
  overrides: Partial<TryOnJob> = {},
): TryOnJob {
  return buildTryOnJob({
    status: JobStatus.FAILED,
    errorCode,
    attempts: 3,
    startedAt: FIXED_NOW,
    finishedAt: new Date(FIXED_NOW.getTime() + 21_000),
    durationMs: 21_000,
    ...overrides,
  });
}

/**
 * A cache hit (§3.7, C-22). No upstream call, no quota decrement, no budget decrement, and
 * no ledger row in either table.
 */
export function buildCachedTryOnJob(cacheKey: string, overrides: Partial<TryOnJob> = {}): TryOnJob {
  return buildSucceededTryOnJob({ cacheHit: true, cacheKey, durationMs: 40, ...overrides });
}

/**
 * An admin test render (A-11). Runs against a built-in reference model, never a consumer
 * photo, and consumes system budget under `TEST_RENDER` rather than anyone's quota.
 */
export function buildTestRenderJob(overrides: Partial<TryOnJob> = {}): TryOnJob {
  return buildTryOnJob({
    origin: JobOrigin.TEST_RENDER,
    isTestRender: true,
    personPhotoId: null,
    referenceModelId: uuid(),
    ...overrides,
  });
}
