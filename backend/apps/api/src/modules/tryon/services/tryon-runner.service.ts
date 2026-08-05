import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

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
import { ResultWriterService, type StoredRender } from '@api/modules/results';
import type { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { TryOnCache } from '../entities/tryon-cache.entity';
import { TryOnJob } from '../entities/tryon-job.entity';
import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';
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
}

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
    @Inject(TRYON_PROVIDER)
    private readonly provider: TryOnProvider,
    @Inject(QUOTA_PORT)
    private readonly quota: QuotaPort,
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
    const job = await this.openJob(request, cacheKey);

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
      throw await this.fail(request, job, error, Date.now() - startedAt);
    } finally {
      this.inFlight -= 1;
      this.metrics.gauge(METRICS.TRYON_IN_FLIGHT, this.inFlight);
    }
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
  private async openJob(request: GenerationRequest, cacheKey: string): Promise<TryOnJob> {
    const isTestRender = request.origin === JobOrigin.TEST_RENDER;

    if (request.existingJobId !== undefined) {
      return this.adoptJob(request.existingJobId, cacheKey);
    }

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

    try {
      return await this.jobs.save(job);
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      throw await this.duplicateOf(request);
    }
  }

  /** Moves a pre-written A-12 batch row from `QUEUED` to `RUNNING`. */
  private async adoptJob(jobId: string, cacheKey: string): Promise<TryOnJob> {
    const job = await this.jobs.findOne({ where: { id: jobId } });

    if (job === null) {
      throw new NotFoundException(ErrorCode.JOB_NOT_FOUND);
    }

    const startedAt = new Date();
    await this.jobs.update({ id: job.id }, { status: JobStatus.RUNNING, startedAt, cacheKey });

    job.status = JobStatus.RUNNING;
    job.startedAt = startedAt;
    job.cacheKey = cacheKey;

    return job;
  }

  /** The `IDEMPOTENCY_IN_FLIGHT` refusal, carrying the winning job's id (§2.4). */
  private async duplicateOf(request: GenerationRequest): Promise<AppException> {
    const existing = await this.jobs.findOne({
      where: { userId: request.userId, idempotencyKey: request.idempotencyKey },
    });

    this.logger.debug('A duplicate idempotency key was refused before any spend.');

    return new ConflictException(ErrorCode.IDEMPOTENCY_IN_FLIGHT, {
      details: existing === null ? {} : { jobId: existing.id },
    });
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
      thumbnailKey: await this.results.thumbnailForStoredRender(copied.storageKey),
      width: copied.width,
      height: copied.height,
      byteSize: copied.byteSize,
    };

    const result = await this.recordResult(request, job, render);
    await this.markSucceeded(job, { cacheHit: true, attempts: 0 });

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

    await this.succeed(request, job, generated.attempts);

    this.metrics.increment(METRICS.TRYON_SUCCEEDED, { origin: request.origin, cacheHit: false });
    this.publishSucceeded(request, job, result, false);

    return { job, result, cacheHit: false };
  }

  /**
   * **The spend.** The only call site of `QuotaPort.chargeSuccess()` in the codebase.
   *
   * It runs after the render is stored and the row is written, so a consumer is never
   * charged for a generation she cannot see. §8.4: "quota and budget decrement only on
   * success".
   */
  private async succeed(
    request: GenerationRequest,
    job: TryOnJob,
    attempts: number,
  ): Promise<void> {
    await this.markSucceeded(job, { cacheHit: false, attempts });

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

  private async markSucceeded(
    job: TryOnJob,
    outcome: { cacheHit: boolean; attempts: number },
  ): Promise<void> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - (job.startedAt?.getTime() ?? finishedAt.getTime());

    job.status = JobStatus.SUCCEEDED;
    job.cacheHit = outcome.cacheHit;
    job.attempts = outcome.attempts;
    job.finishedAt = finishedAt;
    job.durationMs = durationMs;

    await this.jobs.update(
      { id: job.id },
      {
        status: JobStatus.SUCCEEDED,
        cacheHit: outcome.cacheHit,
        attempts: outcome.attempts,
        finishedAt,
        durationMs,
      },
    );
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
   * Note what is absent: any call that could charge. The failure path cannot reach
   * `commitGeneration()` — there is no branch from here to it — which is how "failed
   * jobs never consume quota or budget" is enforced rather than merely intended.
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
      { id: job.id },
      { status: JobStatus.FAILED, errorCode, finishedAt, durationMs: elapsedMs },
    );

    this.metrics.increment(METRICS.TRYON_FAILED, { errorCode, origin: request.origin });
    this.metrics.histogram(METRICS.TRYON_LATENCY_MS, elapsedMs, {
      origin: request.origin,
      cacheHit: false,
      outcome: 'FAILURE',
    });

    if (behaviour.flagGarmentForReview) {
      await this.flagGarment(request, errorCode);
    }

    if (behaviour.surfacedToConsumer) {
      this.stream.publishFailed({
        jobId: job.id,
        errorCode,
        // Verbatim §8.3 copy from ERROR_CODE_SPECS — never an upstream message.
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
