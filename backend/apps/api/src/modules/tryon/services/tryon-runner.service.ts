import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import {
  AppException,
  ConflictException,
  ErrorCode,
  METRICS,
  MetricsService,
  NotFoundException,
  UpstreamException,
} from '@library/common';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { type StoredRender, ResultWriterService } from '@api/modules/results';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { TryOnCache } from '../entities/tryon-cache.entity';
import { TryOnJob } from '../entities/tryon-job.entity';
import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';
import { MODERATION_PORT, type ModerationPort } from '../ports/moderation.port';
import { QUOTA_PORT, type QuotaPort } from '../ports/quota.port';
import {
  TRYON_PROVIDER,
  isTryOnProviderError,
  type TryOnProvider,
} from '../providers/tryon-provider.interface';

import { TryOnCacheService } from './tryon-cache.service';
import { TryOnEventsService } from './tryon-events.service';
import { consumerMessageFor, failureBehaviourFor } from './tryon-failure.policy';

/** One image, as the runner needs it: where the bytes are and what hashes it. */
export interface ImageRef {
  readonly storageKey: string;
  readonly hash: string;
  readonly mimeType: string;
}

/** Everything one generation needs, whoever asked for it. */
export interface GenerationRequest {
  /** The consumer, or the admin who ran the test render (§4.17). */
  readonly userId: string;
  readonly origin: JobOrigin;
  readonly idempotencyKey: string;
  readonly garment: Garment;
  readonly garmentImage: ImageRef;
  readonly person: ImageRef;
  /** Set for a consumer job; `null` for a test render (§4.17). */
  readonly personPhotoId: string | null;
  /** Set instead of `personPhotoId` for a test render (§4.15 — never a consumer photo). */
  readonly referenceModelId: string | null;
  readonly personPhotoLabel: string | null;
  /** `garment.category.name` at the time — snapshotted onto the result (§4.18). */
  readonly categorySnapshot: string;
  /** A-12 bulk test renders. */
  readonly batchId?: string | null;
  /**
   * An already-written `QUEUED` job to adopt instead of inserting a new one.
   *
   * The A-12 bulk path writes its rows up front so the batch is durable and its
   * progress is a query rather than a process-local list; the processor then runs them
   * one at a time. Everything else lets {@link TryOnRunnerService.run} write the row,
   * because for a live request the insert *is* the idempotency check.
   */
  readonly existingJobId?: string;
}

/** What a completed generation produced. */
export interface GenerationOutcome {
  readonly job: TryOnJob;
  readonly result: TryOnResult;
  readonly cacheHit: boolean;
  /**
   * True when this call did not generate anything — the §8.4 idempotency key had already
   * produced a `SUCCEEDED` job and its render is being handed back unchanged.
   */
  readonly replayed?: boolean;
}

/**
 * The job stopped being `RUNNING` while the upstream call was in flight.
 *
 * There is exactly one way that happens: `TryOnJobsService.cancel()`. It deliberately does
 * not abort the upstream call (its own comment says so), so the runner comes back from a
 * seven-second generation to find a row it no longer owns. Internal — never thrown past
 * {@link TryOnRunnerService.run}.
 */
class JobNoLongerRunningError extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} left RUNNING while the generation was in flight.`);
    this.name = 'JobNoLongerRunningError';
  }
}

/**
 * What {@link TryOnRunnerService.openJob} settled on.
 *
 * `REPLAY` is the §8.4 case the entity docstring always described and the code never
 * implemented: the same idempotency key against an already-`SUCCEEDED` job hands back the
 * render it produced instead of starting a second generation or refusing.
 */
type OpenedJob = { kind: 'OPENED'; job: TryOnJob } | { kind: 'REPLAY'; job: TryOnJob };

/** PostgreSQL `unique_violation`. The idempotency index raising it is the design. */
const UNIQUE_VIOLATION = '23505';

/** true when `error` is the unique index refusing a duplicate idempotency key. */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; driverError?: { code?: unknown } };
  return candidate.code === UNIQUE_VIOLATION || candidate.driverError?.code === UNIQUE_VIOLATION;
}

/**
 * **The generation itself — PRD §8.1 steps 4–6, §8.2, §8.3.**
 *
 * The guard chain has already run and said yes. This class writes the job row, looks
 * the cache up, calls upstream if it has to, stores the render, and — only on success —
 * charges. Both callers use it: `TryOnService` for a consumer, `TestRenderService` for
 * the A-11 admin gate. One implementation, so the two can never disagree about what a
 * generation costs.
 *
 * ### The rule the file is built around
 *
 * > "Failed jobs never consume quota or budget." — PRD §8.3
 *
 * `QuotaPort.commitGeneration()` appears **once** in this codebase, in
 * {@link succeed}, after the render is stored and the job is marked `SUCCEEDED`. There
 * is no early charge and no compensating refund, because a refund path is a place for a
 * charge to survive a rollback. A cache hit does not reach it either (C-22): the render
 * is copied, `hitCount` goes up, nothing is spent.
 *
 * ### Idempotency (§8.4)
 *
 * `UQ_tryon_jobs_idem UNIQUE ("userId","idempotencyKey")` is the mechanism, not a
 * safety net. Two concurrent identical requests both pass the guard chain — neither can
 * see the other's row yet — and both try to insert. The database refuses one, and the
 * loser is converted to `IDEMPOTENCY_IN_FLIGHT` carrying the winner's `jobId`, so the
 * client attaches to the existing SSE stream instead of starting a second generation.
 * One job, one charge, one render.
 *
 * ### The call is held open (§8.2)
 *
 * There is no queue in V1 and no invocation timeout to work around: the API is a
 * persistent NestJS process, so the upstream call is simply awaited while the job row
 * carries state and the SSE stream carries progress.
 */
@Injectable()
export class TryOnRunnerService {
  private readonly logger = new Logger(TryOnRunnerService.name);

  private inFlight = 0;

  constructor(
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    // Read-only, and only ever by `jobId`: the §8.4 replay needs the render an earlier
    // call already produced, and the failure path needs to withdraw one that should not
    // stand. `ResultWriterService` remains the only way a row is *written*.
    @InjectRepository(TryOnResult)
    private readonly resultRows: Repository<TryOnResult>,
    @Inject(TRYON_PROVIDER)
    private readonly provider: TryOnProvider,
    @Inject(QUOTA_PORT)
    private readonly quota: QuotaPort,
    @Inject(MODERATION_PORT)
    private readonly moderation: ModerationPort,
    private readonly cache: TryOnCacheService,
    private readonly storage: StorageService,
    private readonly results: ResultWriterService,
    private readonly stream: TryOnEventsService,
    private readonly metrics: MetricsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Runs one generation end to end.
   *
   * @throws {ConflictException} `IDEMPOTENCY_IN_FLIGHT` when an identical request is
   * already running — `details.jobId` names the job to attach to.
   * @throws {UpstreamException} carrying the §8.3 code and its verbatim consumer copy.
   */
  async run(request: GenerationRequest): Promise<GenerationOutcome> {
    const cacheKey = this.cache.buildKey(request.garmentImage.hash, request.person.hash);
    const opened = await this.openJob(request, cacheKey);

    if (opened.kind === 'REPLAY') {
      return this.replay(opened.job);
    }

    const job = opened.job;

    this.metrics.increment(METRICS.TRYON_STARTED, { origin: request.origin });
    this.inFlight += 1;
    this.metrics.gauge(METRICS.TRYON_IN_FLIGHT, this.inFlight);

    const startedAt = Date.now();

    try {
      const cached = await this.cache.lookup(cacheKey);

      const outcome =
        cached === null
          ? await this.generate(request, job, cacheKey)
          : await this.serveFromCache(request, job, cached);

      this.metrics.histogram(METRICS.TRYON_LATENCY_MS, Date.now() - startedAt, {
        origin: request.origin,
        cacheHit: outcome.cacheHit,
        outcome: 'SUCCESS',
      });

      return outcome;
    } catch (error: unknown) {
      if (error instanceof JobNoLongerRunningError) {
        throw await this.abandon(request, job);
      }
      throw await this.fail(request, job, error, Date.now() - startedAt);
    } finally {
      this.inFlight -= 1;
      this.metrics.gauge(METRICS.TRYON_IN_FLIGHT, this.inFlight);
    }
  }

  /**
   * A generation the consumer cancelled out from under, discarded without a charge.
   *
   * `cancel()` told her it cost nothing, and the fix for that promise is here rather than
   * there: the runner is the only thing that knows whether it got as far as spending. The
   * bytes that were written stay unreferenced and the §3.5 orphan sweep reclaims them —
   * cheaper than a render she did not wait for and is not paying for.
   *
   * The row itself is left exactly as `cancel()` wrote it. `RESOURCE_CONFLICT` is returned
   * rather than a §8.3 upstream code because nothing upstream went wrong; the caller's own
   * request simply lost its job.
   */
  private async abandon(request: GenerationRequest, job: TryOnJob): Promise<AppException> {
    await this.withdrawResultFor(job.id);

    this.metrics.increment(METRICS.TRYON_FAILED, {
      errorCode: ErrorCode.RESOURCE_CONFLICT,
      origin: request.origin,
    });

    this.logger.log(
      `Job ${job.id} was cancelled while its generation was in flight. ` +
        'The render was discarded and nothing was charged (§5.11).',
    );

    return new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
      message: 'That try-on was cancelled while it was running, so nothing was charged.',
      details: { jobId: job.id },
    });
  }

  /**
   * §8.4 — the same idempotency key, replayed.
   *
   * The entity docstring has always described this ("a `SUCCEEDED` job is not a rejection —
   * the caller replays its result") and nothing implemented it: every duplicate, whatever
   * its status, came back as `IDEMPOTENCY_IN_FLIGHT`. A client that retried after a dropped
   * connection was pointed at a finished job and told to wait for a stream that had already
   * closed.
   */
  private async replay(job: TryOnJob): Promise<GenerationOutcome> {
    const result = await this.resultRows.findOne({ where: { jobId: job.id } });

    if (result === null) {
      // SUCCEEDED with no render is not a state this system produces — the result row is
      // written before the job is marked. Treat it as gone rather than replay a lie.
      throw new NotFoundException(ErrorCode.RESULT_NOT_FOUND);
    }

    this.logger.debug('An idempotency key was replayed against an already successful job.');

    return { job, result, cacheHit: job.cacheHit, replayed: true };
  }

  /* -----------------------------------------------------------------------------------------
   * Job lifecycle
   * -------------------------------------------------------------------------------------- */

  /**
   * §8.1 step 5 — the `tryon_jobs` row, written as `RUNNING` before anything is spent.
   *
   * The insert is the idempotency check. Re-reading first and inserting after would
   * leave a window between the two wide enough for a double-click to fit through, which
   * is the exact thing §8.4 asks this key to prevent.
   */
  private async openJob(request: GenerationRequest, cacheKey: string): Promise<OpenedJob> {
    if (request.existingJobId !== undefined) {
      return { kind: 'OPENED', job: await this.adoptJob(request.existingJobId, cacheKey) };
    }

    try {
      return { kind: 'OPENED', job: await this.insertJob(request, cacheKey) };
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.resolveDuplicate(request, cacheKey);
    }
  }

  /** The `tryon_jobs` insert itself. Separated so the retry after a key release is one call. */
  private async insertJob(request: GenerationRequest, cacheKey: string): Promise<TryOnJob> {
    const isTestRender = request.origin === JobOrigin.TEST_RENDER;

    const job = this.jobs.create({
      userId: request.userId,
      garmentId: request.garment.id,
      personPhotoId: request.personPhotoId,
      referenceModelId: request.referenceModelId,
      origin: request.origin,
      // §4.17: kept per PRD §12; always equals `origin = TEST_RENDER`.
      isTestRender,
      idempotencyKey: request.idempotencyKey,
      status: JobStatus.RUNNING,
      cacheHit: false,
      cacheKey,
      errorCode: null,
      attempts: 0,
      batchId: request.batchId ?? null,
      startedAt: new Date(),
      finishedAt: null,
      durationMs: null,
    });

    return this.jobs.save(job);
  }

  /**
   * Moves a pre-written A-12 batch row from `QUEUED` to `RUNNING` — **atomically**.
   *
   * The predicate is the claim. `update({ id }, { status: RUNNING })` with no `status`
   * re-assertion reports success whoever else already adopted the row, so two processor
   * ticks that both read the same `QUEUED` job would both run it and the platform would pay
   * twice for one catalogue render. `affected === 1` says this call, and only this call,
   * moved it — the same argument `OutboxProcessor.claimDue()` makes at length for the
   * outbox, and for the same reason.
   */
  private async adoptJob(jobId: string, cacheKey: string): Promise<TryOnJob> {
    const startedAt = new Date();

    const claim = await this.jobs.update(
      { id: jobId, status: JobStatus.QUEUED },
      { status: JobStatus.RUNNING, startedAt, cacheKey },
    );

    if ((claim.affected ?? 0) !== 1) {
      // Either the row is gone or somebody else has it. Both are "not mine to run", and
      // the batch processor treats the refusal as "nothing to do this tick".
      throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
        message: 'That batch item is no longer queued.',
        details: { jobId },
      });
    }

    const job = await this.jobs.findOne({ where: { id: jobId } });
    if (job === null) {
      throw new NotFoundException(ErrorCode.JOB_NOT_FOUND);
    }

    return job;
  }

  /**
   * **§8.4, all four outcomes.** What to do when the unique index refuses a duplicate key.
   *
   * The index has no status in its predicate and nothing soft-deletes a job, so *every*
   * repeat of a key collided — and the answer was always `IDEMPOTENCY_IN_FLIGHT` pointing
   * at whatever row was there. Two of the four cases were wrong:
   *
   * | Existing job | Correct answer | What it used to do |
   * | --- | --- | --- |
   * | `QUEUED` / `RUNNING` | refuse, attach to the stream (§2.4) | ✔ |
   * | `SUCCEEDED` | replay the render | 409 at a finished job |
   * | `FAILED` / `CANCELLED` | **retry** — it charged nothing | 409, forever |
   *
   * The last row is the serious one. `checkIdempotency()` returns `null` for `FAILED` and
   * documents why — "a failed job charged nothing, so retrying the same key is exactly what
   * a client should do" — and then the insert hit the index anyway and the client was told
   * to attach to a stream that had already closed. The documented retry path for the entire
   * §8.3 taxonomy did not work.
   *
   * A spent key is released by soft-deleting its row, which is precisely what
   * `WHERE "deletedAt" IS NULL` on `UQ_tryon_jobs_idem` exists to permit. The row is not
   * destroyed — E-13 still counts it, `deletedAt` is not `DELETE` — it just stops owning
   * the key. The insert is then retried **once**: a second collision is a genuine race with
   * another request for the same key, and that one really is in flight.
   */
  private async resolveDuplicate(request: GenerationRequest, cacheKey: string): Promise<OpenedJob> {
    const existing = await this.jobs.findOne({
      where: { userId: request.userId, idempotencyKey: request.idempotencyKey },
    });

    if (existing === null) {
      // The colliding row vanished between the insert and the read. Nothing owns the key
      // now, so one more attempt is the honest answer.
      return { kind: 'OPENED', job: await this.insertJob(request, cacheKey) };
    }

    if (existing.status === JobStatus.SUCCEEDED) {
      return { kind: 'REPLAY', job: existing };
    }

    if (existing.status === JobStatus.QUEUED || existing.status === JobStatus.RUNNING) {
      this.logger.debug('A duplicate idempotency key was refused before any spend.');
      throw new ConflictException(ErrorCode.IDEMPOTENCY_IN_FLIGHT, {
        details: { jobId: existing.id },
      });
    }

    // FAILED or CANCELLED — spent nothing, so the key is hers to use again.
    await this.jobs.softDelete({ id: existing.id });
    this.logger.debug(
      `Released idempotency key from ${existing.status} job ${existing.id} for a retry (§8.4).`,
    );

    try {
      return { kind: 'OPENED', job: await this.insertJob(request, cacheKey) };
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Somebody won the released key first. That one is genuinely in flight.
      const winner = await this.jobs.findOne({
        where: { userId: request.userId, idempotencyKey: request.idempotencyKey },
      });
      throw new ConflictException(ErrorCode.IDEMPOTENCY_IN_FLIGHT, {
        details: winner === null ? {} : { jobId: winner.id },
      });
    }
  }

  /* -----------------------------------------------------------------------------------------
   * The two ways a job succeeds
   * -------------------------------------------------------------------------------------- */

  /** §8.1 step 4 / §3.7 — a hit. **Consumes no quota and no budget** (C-22). */
  private async serveFromCache(
    request: GenerationRequest,
    job: TryOnJob,
    cached: TryOnCache,
  ): Promise<GenerationOutcome> {
    this.publishStage(job, 'FINISHING');

    const copied = await this.cache.copyForUser(cached, request.userId);
    const render: StoredRender = {
      storageKey: copied.storageKey,
      // Two file copies, no image encoding. The render *and* its thumbnail already exist for
      // these exact bytes; re-running sharp over a full-size PNG here was hundreds of
      // milliseconds of CPU on the one path §9.1 gives a 400 ms p95 to.
      thumbnailKey: await this.results.thumbnailForCachedRender({
        cacheKey: cached.cacheKey,
        storageKey: copied.storageKey,
      }),
      width: copied.width,
      height: copied.height,
      byteSize: copied.byteSize,
    };

    // Claimed before the result row is written, for the same reason as on the generate
    // path: a job she cancelled must not come back with a render attached to it.
    if (!(await this.markSucceeded(job, { cacheHit: true, attempts: 0 }))) {
      throw new JobNoLongerRunningError(job.id);
    }

    const result = await this.recordResult(request, job, render);

    this.metrics.increment(METRICS.TRYON_SUCCEEDED, { origin: request.origin, cacheHit: true });
    this.publishSucceeded(request, job, result, true);

    return { job, result, cacheHit: true };
  }

  /** §8.1 steps 5–6 — a miss. The only path that reaches the upstream and the ledger. */
  private async generate(
    request: GenerationRequest,
    job: TryOnJob,
    cacheKey: string,
  ): Promise<GenerationOutcome> {
    this.publishStage(job, 'UPLOADING');

    const [garmentBytes, personBytes] = await Promise.all([
      this.storage.getBuffer(request.garmentImage.storageKey),
      this.storage.getBuffer(request.person.storageKey),
    ]);

    this.publishStage(job, 'GENERATING');

    const generated = await this.provider.generate({
      garmentImage: garmentBytes,
      garmentImageMimeType: request.garmentImage.mimeType,
      personImage: personBytes,
      personImageMimeType: request.person.mimeType,
      // A job id and nothing else — never a user id, a photo id or a key (E-12).
      correlationId: job.id,
    });

    this.metrics.histogram(METRICS.TRYON_UPSTREAM_LATENCY_MS, generated.durationMs, {
      driver: this.provider.name,
      attempt: generated.attempts,
    });
    if (generated.attempts > 1) {
      this.metrics.increment(
        METRICS.TRYON_RETRIED,
        { attempt: generated.attempts },
        generated.attempts - 1,
      );
    }

    this.publishStage(job, 'FINISHING');

    const render = await this.results.storeRender(request.userId, generated.png, {
      width: generated.width,
      height: generated.height,
    });

    // ---- the terminal section, and its order is the whole argument ----
    //
    // 1. **Claim the row.** `markSucceeded` only moves a job that is still `RUNNING`. If
    //    she cancelled at t+2s while this call was upstream at t+7s, the claim fails and
    //    nothing below runs — no charge, no result row, no free render. Both writes used
    //    to be unconditional `update({ id }, …)`, so a cancelled job was overwritten
    //    `CANCELLED → SUCCEEDED` and then charged for.
    //
    // 2. **Charge.** Before the result row exists, not after. Two generations racing at
    //    `remaining = 1` both pass the read-only guard and both reach here; the loser's
    //    `consumeWithin` throws `QUOTA_EXHAUSTED` and there is nothing to take away,
    //    because nothing visible has been written yet. Charging last left her with a
    //    live, downloadable render under a `FAILED` job and no ledger row.
    //
    //    The bytes exist by this point, so §8.4's promise still holds in the direction it
    //    was written for: she is never charged for a generation that cannot be delivered.
    //
    // 3. **Record and remember.** If either fails, `fail()` reverses the charge through
    //    `releaseOnFailure` and withdraws whatever was written.
    if (!(await this.markSucceeded(job, { cacheHit: false, attempts: generated.attempts }))) {
      throw new JobNoLongerRunningError(job.id);
    }

    await this.succeed(request, job);

    const result = await this.recordResult(request, job, render);

    // §3.7 — the canonical cache copy is this user's own render. A later hit copies it
    // again into whoever asks, so no two users ever share a file.
    await this.cache.remember({
      cacheKey,
      garmentSourceHash: request.garmentImage.hash,
      personPhotoHash: request.person.hash,
      garmentId: request.garment.id,
      storageKey: render.storageKey,
      width: render.width,
      height: render.height,
    });

    this.metrics.increment(METRICS.TRYON_SUCCEEDED, { origin: request.origin, cacheHit: false });
    this.publishSucceeded(request, job, result, false);

    return { job, result, cacheHit: false };
  }

  /**
   * **The spend.** The only call site of `QuotaPort.chargeSuccess()` in the codebase.
   *
   * It runs after the render's bytes are stored and after the job row has been *claimed*
   * as `SUCCEEDED`, so a consumer is never charged for a generation she cannot see and
   * never charged for one she cancelled. §8.4: "quota and budget decrement only on
   * success". See {@link generate} for why it now precedes the `tryon_results` row rather
   * than following it.
   */
  private async succeed(request: GenerationRequest, job: TryOnJob): Promise<void> {
    const isTestRender = request.origin === JobOrigin.TEST_RENDER;

    await this.quota.chargeSuccess({
      jobId: job.id,
      // §8.4: a test render is charged to the platform budget under its own reason and
      // to nobody's quota, so A-33 can split admin work from consumer demand.
      userId: isTestRender ? null : request.userId,
      origin: isTestRender ? 'TEST_RENDER' : 'CONSUMER',
      actorId: isTestRender ? request.userId : null,
    });

    this.metrics.increment(METRICS.BUDGET_CONSUMED, {
      reason: isTestRender ? 'TEST_RENDER' : 'CONSUMER_GENERATION',
    });

    // A-14 — the catalogue's "most tried" ordering. Not a spend, but it belongs to the
    // same moment: a generation happened against this piece.
    await this.garments.update(
      { id: request.garment.id },
      { tryOnCount: request.garment.tryOnCount + 1, lastTriedAt: new Date() },
    );
  }

  /**
   * Claims the job as `SUCCEEDED`, **only if it is still `RUNNING`**.
   *
   * @returns `false` when the row moved on — in practice, when she cancelled it (§5.11).
   *
   * The predicate is the fix for a job that was cancelled at t+2s and overwritten
   * `CANCELLED → SUCCEEDED` at t+7s, taking a quota decrement and a budget decrement with
   * it. The in-memory `job` is only mutated once the database agrees, so a caller cannot
   * read a status off it that no row has.
   */
  private async markSucceeded(
    job: TryOnJob,
    outcome: { cacheHit: boolean; attempts: number },
  ): Promise<boolean> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - (job.startedAt?.getTime() ?? finishedAt.getTime());

    const claim = await this.jobs.update(
      { id: job.id, status: JobStatus.RUNNING },
      {
        status: JobStatus.SUCCEEDED,
        cacheHit: outcome.cacheHit,
        attempts: outcome.attempts,
        finishedAt,
        durationMs,
      },
    );

    if ((claim.affected ?? 0) === 0) {
      return false;
    }

    job.status = JobStatus.SUCCEEDED;
    job.cacheHit = outcome.cacheHit;
    job.attempts = outcome.attempts;
    job.finishedAt = finishedAt;
    job.durationMs = durationMs;

    return true;
  }

  private async recordResult(
    request: GenerationRequest,
    job: TryOnJob,
    render: StoredRender,
  ): Promise<TryOnResult> {
    return this.results.persist({
      jobId: job.id,
      userId: request.userId,
      garmentId: request.garment.id,
      personPhotoId: request.personPhotoId,
      cacheKey: job.cacheKey ?? '',
      render,
      isTestRender: request.origin === JobOrigin.TEST_RENDER,
      // §4.18 — the snapshots are the feature, not an optimisation (C-28, C-29).
      garmentTitleSnapshot: request.garment.title,
      garmentCategorySnapshot: request.categorySnapshot,
      garmentPriceSnapshot: request.garment.price,
      garmentCurrencySnapshot: request.garment.currency,
      personPhotoLabelSnapshot: request.personPhotoLabel,
    });
  }

  /* -----------------------------------------------------------------------------------------
   * Failure (§8.3)
   * -------------------------------------------------------------------------------------- */

  /**
   * Marks the job failed, applies the §8.3 system behaviour, and returns the exception
   * the caller should throw.
   *
   * Returning it rather than rethrowing here is what turns a provider's
   * `TryOnProviderError` — which has no HTTP status and whose `message` is for the log
   * — into the `UpstreamException` whose message is the verbatim §8.3 consumer copy.
   * The consumer never sees an upstream string.
   *
   * ### What a failure now undoes
   *
   * Almost every failure happens before anything was written, and for those all three of
   * the compensations below are no-ops. The exceptions are real, though, and used to leave
   * durable damage:
   *
   *  - **The status predicate.** `update({ id }, …)` with no predicate overwrote a
   *    `CANCELLED` row, so a job she gave up on came back as a failure she never saw.
   *    `QUEUED`/`RUNNING`/`SUCCEEDED` are the states a failure may move; `CANCELLED` is
   *    hers and is left alone.
   *  - **`releaseOnFailure`.** It was written for exactly this and called from nowhere in
   *    production code. Now the charge that committed just before a later step blew up is
   *    actually taken back. It is idempotent in both ledgers, so calling it on every
   *    failure — which is what makes it reliable — costs nothing when there is no charge.
   *  - **Withdrawing the render.** A `tryon_results` row under a `FAILED` job is a
   *    downloadable render nobody paid for. It is soft-deleted, so C-27's history is
   *    intact for anything that reads `withDeleted` and the consumer's gallery is honest.
   *
   * There is still no branch from here that could *charge* — that direction of "failed jobs
   * never consume quota or budget" is unchanged and remains structural.
   */
  private async fail(
    request: GenerationRequest,
    job: TryOnJob,
    error: unknown,
    elapsedMs: number,
  ): Promise<AppException> {
    const errorCode = this.codeOf(error);
    const behaviour = failureBehaviourFor(errorCode);
    const finishedAt = new Date();

    await this.jobs.update(
      {
        id: job.id,
        status: In([JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.SUCCEEDED]),
      },
      { status: JobStatus.FAILED, errorCode, finishedAt, durationMs: elapsedMs },
    );

    await this.quota.releaseOnFailure({
      jobId: job.id,
      userId: request.origin === JobOrigin.TEST_RENDER ? null : request.userId,
      reason: `Generation failed: ${errorCode}`,
    });

    await this.withdrawResultFor(job.id);

    this.metrics.increment(METRICS.TRYON_FAILED, { errorCode, origin: request.origin });
    this.metrics.histogram(METRICS.TRYON_LATENCY_MS, elapsedMs, {
      origin: request.origin,
      cacheHit: false,
      outcome: 'FAILURE',
    });

    if (behaviour.flagGarmentForReview) {
      await this.flagGarment(request, errorCode);
    }

    if (behaviour.queueModeration) {
      await this.queueModeration(request, job, errorCode);
    }

    if (behaviour.alertAdmin) {
      this.raiseAdminAlert(request, job, errorCode);
    }

    if (behaviour.surfacedToConsumer) {
      this.stream.publishFailed({
        jobId: job.id,
        errorCode,
        // Verbatim §8.3 copy from ERROR_CODE_SPECS — never an upstream message.
        message: consumerMessageFor(errorCode),
      });
    } else {
      // `UPSTREAM_RATE_LIMITED` is the only code marked `surfacedToConsumer: false`, and
      // reaching this branch through a provider is impossible: `runWithRetry`'s
      // `terminalCodeFor()` maps an exhausted rate limit to `UPSTREAM_UNAVAILABLE` first,
      // exactly so a job "never [fails as] a code §2.4 says is never surfaced". While the
      // backoff is still running the job genuinely is `RUNNING` and the stream genuinely
      // should stay open — that is what the flag is about, and it happens a layer below.
      //
      // A branch that publishes nothing is still one refactor away from an SSE stream that
      // stays open until the client gives up, with the D-5 error state never rendering. So
      // the stream is closed here too, with the same verbatim §8.3 copy. "Not surfaced" was
      // about not blaming her for our rate limit; it was never about leaving her waiting.
      this.stream.publishFailed({
        jobId: job.id,
        errorCode,
        message: consumerMessageFor(errorCode),
      });
    }

    this.logger.warn(
      `Generation failed: ${errorCode} after ${elapsedMs}ms. jobId=${job.id} ` +
        `origin=${request.origin}`,
    );

    return error instanceof AppException
      ? error
      : new UpstreamException(errorCode, { details: { jobId: job.id }, cause: error });
  }

  /**
   * Soft-deletes any `tryon_results` row written for a job that did not end successfully.
   *
   * Soft, not hard: §4.18 makes a result permanent (C-27) and the storage key is still on
   * the row, so the §3.5 orphan sweep can see the bytes are unreferenced and reclaim them.
   * A hard delete would strand them.
   */
  private async withdrawResultFor(jobId: string): Promise<void> {
    const withdrawn = await this.resultRows.softDelete({ jobId });

    if ((withdrawn.affected ?? 0) > 0) {
      this.logger.warn(
        `Withdrew ${withdrawn.affected ?? 0} render(s) for job ${jobId}: the generation did ` +
          'not complete, so nothing is left downloadable that was not charged for.',
      );
    }
  }

  /**
   * A-15 — a garment the upstream cannot read is a catalogue problem, not a consumer
   * problem. `failureCount` goes up and the piece is flagged for review, so an admin
   * sees it on the catalog-health screen rather than a consumer seeing it twice.
   */
  private async flagGarment(request: GenerationRequest, errorCode: ErrorCode): Promise<void> {
    await this.garments.update(
      { id: request.garment.id },
      { failureCount: request.garment.failureCount + 1, flaggedForReview: true },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.GARMENT_FLAGGED_FOR_REVIEW,
        targetType: AUDIT_TARGET_TYPES.GARMENT,
        actorId: null,
        targetId: request.garment.id,
        targetLabel: request.garment.title,
        metadata: { errorCode },
      }),
    );
  }

  /**
   * §8.3's `queueModeration` behaviour — `MODERATION_REJECTED`, and only that.
   *
   * See {@link ModerationPort} for what was happening while this flag went unread: no
   * A-34 row, no block on the photograph, and the same image failing upstream at cost on
   * every retry.
   */
  private async queueModeration(
    request: GenerationRequest,
    job: TryOnJob,
    errorCode: ErrorCode,
  ): Promise<void> {
    await this.moderation.queueForReview({
      personPhotoId: request.personPhotoId,
      userId: request.origin === JobOrigin.TEST_RENDER ? null : request.userId,
      jobId: job.id,
      reasonCode: errorCode,
    });
  }

  /**
   * §8.3's `alertAdmin` behaviour — "an admin hears about it immediately".
   *
   * Two codes carry it. `BUDGET_EXHAUSTED` already reaches an admin by a better route:
   * `BudgetService.emitThresholdEvents()` fires `QUOTA_EVENTS.BUDGET_EXHAUSTED` on the
   * charge that crossed the line and `BudgetAlertListener` emails it, once, on the
   * crossing rather than on every subsequent refusal — a second page from here would be
   * the "alert an admin four hundred times" failure that file argues against at length.
   *
   * `TRYON_PROVIDER_MISCONFIGURED` has no such route, and startup validation is supposed
   * to have caught it first. Reaching it at runtime means the provider was reconfigured
   * under a live process. That is an operator fact, so it is logged at error level and
   * written to `audit_log` through the §2.9 rule 4 listener — durable, queryable, and
   * requiring no new notification template whose copy §8.3 does not specify.
   */
  private raiseAdminAlert(request: GenerationRequest, job: TryOnJob, errorCode: ErrorCode): void {
    this.logger.error(
      `A generation failed with an admin-alerting code: ${errorCode}. jobId=${job.id} ` +
        `origin=${request.origin}`,
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.TRYON_ALERT_RAISED,
        targetType: AUDIT_TARGET_TYPES.TRYON_JOB,
        actorId: null,
        targetId: job.id,
        metadata: { errorCode, origin: request.origin },
      }),
    );
  }

  /** The §8.3 code for whatever went wrong, defaulting to the safe, non-retrying one. */
  private codeOf(error: unknown): ErrorCode {
    if (isTryOnProviderError(error)) {
      return error.errorCode;
    }
    if (error instanceof AppException) {
      return error.errorCode;
    }
    return ErrorCode.INTERNAL_ERROR;
  }

  /* -----------------------------------------------------------------------------------------
   * SSE (§5.11)
   * -------------------------------------------------------------------------------------- */

  private publishStage(job: TryOnJob, stage: 'UPLOADING' | 'GENERATING' | 'FINISHING'): void {
    this.stream.publishStage({
      stage,
      jobId: job.id,
      elapsedMs: Date.now() - (job.startedAt?.getTime() ?? Date.now()),
    });
  }

  private publishSucceeded(
    request: GenerationRequest,
    job: TryOnJob,
    result: TryOnResult,
    cacheHit: boolean,
  ): void {
    this.stream.publishSucceeded({
      jobId: job.id,
      resultId: result.id,
      url: this.storage.signedUrl(result.storageKey, request.userId),
      thumbnailUrl:
        result.thumbnailKey === null
          ? null
          : this.storage.signedUrl(result.thumbnailKey, request.userId),
      width: result.width,
      height: result.height,
      cacheHit,
    });
  }
}
