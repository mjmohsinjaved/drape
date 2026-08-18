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
import { isTryOnProviderError } from '../providers/tryon-provider.interface';
import {
  TRYON_PROVIDER_RESOLVER,
  type ResolvedTryOnProvider,
  type TryOnProviderResolver,
} from '../providers/tryon-provider.resolver';

import { TryOnCacheService } from './tryon-cache.service';
import { TryOnEventsService } from './tryon-events.service';
import { consumerMessageFor, failureBehaviourFor } from './tryon-failure.policy';

export interface ImageRef {
  readonly storageKey: string;
  readonly hash: string;
  readonly mimeType: string;
}

export interface GenerationRequest {
  readonly userId: string;
  readonly origin: JobOrigin;
  readonly idempotencyKey: string;
  readonly garment: Garment;
  readonly garmentImage: ImageRef;
  readonly person: ImageRef;
  readonly personPhotoId: string | null;
  readonly referenceModelId: string | null;
  readonly personPhotoLabel: string | null;
  readonly categorySnapshot: string;
  readonly batchId?: string | null;
  readonly existingJobId?: string;
}

export interface GenerationOutcome {
  readonly job: TryOnJob;
  readonly result: TryOnResult;
  readonly cacheHit: boolean;
  readonly replayed?: boolean;
}

class JobNoLongerRunningError extends Error {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} left RUNNING while the generation was in flight.`);
    this.name = 'JobNoLongerRunningError';
  }
}

type OpenedJob = { kind: 'OPENED'; job: TryOnJob } | { kind: 'REPLAY'; job: TryOnJob };

const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; driverError?: { code?: unknown } };
  return candidate.code === UNIQUE_VIOLATION || candidate.driverError?.code === UNIQUE_VIOLATION;
}

@Injectable()
export class TryOnRunnerService {
  private readonly logger = new Logger(TryOnRunnerService.name);

  private inFlight = 0;

  constructor(
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(TryOnResult)
    private readonly resultRows: Repository<TryOnResult>,
    @Inject(TRYON_PROVIDER_RESOLVER)
    private readonly providers: TryOnProviderResolver,
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

  async run(request: GenerationRequest): Promise<GenerationOutcome> {
    const resolved = await this.providers.resolve();

    const cacheKey = this.cache.buildKey(
      request.garmentImage.hash,
      request.person.hash,
      resolved.driver,
    );
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
          ? await this.generate(request, job, cacheKey, resolved)
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

  private async replay(job: TryOnJob): Promise<GenerationOutcome> {
    const result = await this.resultRows.findOne({ where: { jobId: job.id } });

    if (result === null) {
      throw new NotFoundException(ErrorCode.RESULT_NOT_FOUND);
    }

    this.logger.debug('An idempotency key was replayed against an already successful job.');

    return { job, result, cacheHit: job.cacheHit, replayed: true };
  }

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

  private async insertJob(request: GenerationRequest, cacheKey: string): Promise<TryOnJob> {
    const isTestRender = request.origin === JobOrigin.TEST_RENDER;

    const job = this.jobs.create({
      userId: request.userId,
      garmentId: request.garment.id,
      personPhotoId: request.personPhotoId,
      referenceModelId: request.referenceModelId,
      origin: request.origin,
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

  private async adoptJob(jobId: string, cacheKey: string): Promise<TryOnJob> {
    const startedAt = new Date();

    const claim = await this.jobs.update(
      { id: jobId, status: JobStatus.QUEUED },
      { status: JobStatus.RUNNING, startedAt, cacheKey },
    );

    if ((claim.affected ?? 0) !== 1) {
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

  private async resolveDuplicate(request: GenerationRequest, cacheKey: string): Promise<OpenedJob> {
    const existing = await this.jobs.findOne({
      where: { userId: request.userId, idempotencyKey: request.idempotencyKey },
    });

    if (existing === null) {
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
      const winner = await this.jobs.findOne({
        where: { userId: request.userId, idempotencyKey: request.idempotencyKey },
      });
      throw new ConflictException(ErrorCode.IDEMPOTENCY_IN_FLIGHT, {
        details: winner === null ? {} : { jobId: winner.id },
      });
    }
  }

  private async serveFromCache(
    request: GenerationRequest,
    job: TryOnJob,
    cached: TryOnCache,
  ): Promise<GenerationOutcome> {
    this.publishStage(job, 'FINISHING');

    const copied = await this.cache.copyForUser(cached, request.userId);
    const render: StoredRender = {
      storageKey: copied.storageKey,
      thumbnailKey: await this.results.thumbnailForCachedRender({
        cacheKey: cached.cacheKey,
        storageKey: copied.storageKey,
      }),
      width: copied.width,
      height: copied.height,
      byteSize: copied.byteSize,
    };

    if (!(await this.markSucceeded(job, { cacheHit: true, attempts: 0 }))) {
      throw new JobNoLongerRunningError(job.id);
    }

    const result = await this.recordResult(request, job, render);

    this.metrics.increment(METRICS.TRYON_SUCCEEDED, { origin: request.origin, cacheHit: true });
    this.publishSucceeded(request, job, result, true);

    return { job, result, cacheHit: true };
  }

  private async generate(
    request: GenerationRequest,
    job: TryOnJob,
    cacheKey: string,
    resolved: ResolvedTryOnProvider,
  ): Promise<GenerationOutcome> {
    this.publishStage(job, 'UPLOADING');

    const [garmentBytes, personBytes] = await Promise.all([
      this.storage.getBuffer(request.garmentImage.storageKey),
      this.storage.getBuffer(request.person.storageKey),
    ]);

    this.publishStage(job, 'GENERATING');

    const generated = await resolved.provider.generate({
      garmentImage: garmentBytes,
      garmentImageMimeType: request.garmentImage.mimeType,
      personImage: personBytes,
      personImageMimeType: request.person.mimeType,
      correlationId: job.id,
    });

    this.metrics.histogram(METRICS.TRYON_UPSTREAM_LATENCY_MS, generated.durationMs, {
      driver: resolved.provider.name,
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

    if (!(await this.markSucceeded(job, { cacheHit: false, attempts: generated.attempts }))) {
      throw new JobNoLongerRunningError(job.id);
    }

    await this.succeed(request, job);

    const result = await this.recordResult(request, job, render);

    await this.cache.remember({
      cacheKey,
      garmentSourceHash: request.garmentImage.hash,
      personPhotoHash: request.person.hash,
      garmentId: request.garment.id,
      storageKey: render.storageKey,
      width: render.width,
      height: render.height,
      driver: resolved.driver,
    });

    this.metrics.increment(METRICS.TRYON_SUCCEEDED, { origin: request.origin, cacheHit: false });
    this.publishSucceeded(request, job, result, false);

    return { job, result, cacheHit: false };
  }

  private async succeed(request: GenerationRequest, job: TryOnJob): Promise<void> {
    const isTestRender = request.origin === JobOrigin.TEST_RENDER;

    await this.quota.chargeSuccess({
      jobId: job.id,
      userId: isTestRender ? null : request.userId,
      origin: isTestRender ? 'TEST_RENDER' : 'CONSUMER',
      actorId: isTestRender ? request.userId : null,
    });

    this.metrics.increment(METRICS.BUDGET_CONSUMED, {
      reason: isTestRender ? 'TEST_RENDER' : 'CONSUMER_GENERATION',
    });

    await this.garments.update(
      { id: request.garment.id },
      { tryOnCount: request.garment.tryOnCount + 1, lastTriedAt: new Date() },
    );
  }

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
      garmentTitleSnapshot: request.garment.title,
      garmentCategorySnapshot: request.categorySnapshot,
      garmentPriceSnapshot: request.garment.price,
      garmentCurrencySnapshot: request.garment.currency,
      personPhotoLabelSnapshot: request.personPhotoLabel,
    });
  }

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
        message: consumerMessageFor(errorCode),
      });
    } else {
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

  private async withdrawResultFor(jobId: string): Promise<void> {
    const withdrawn = await this.resultRows.softDelete({ jobId });

    if ((withdrawn.affected ?? 0) > 0) {
      this.logger.warn(
        `Withdrew ${withdrawn.affected ?? 0} render(s) for job ${jobId}: the generation did ` +
          'not complete, so nothing is left downloadable that was not charged for.',
      );
    }
  }

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

  private codeOf(error: unknown): ErrorCode {
    if (isTryOnProviderError(error)) {
      return error.errorCode;
    }
    if (error instanceof AppException) {
      return error.errorCode;
    }
    return ErrorCode.INTERNAL_ERROR;
  }

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
