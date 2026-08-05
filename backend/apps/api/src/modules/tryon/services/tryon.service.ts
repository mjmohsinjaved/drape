import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  METRICS,
  MetricsService,
  NotFoundException,
  Role,
  type ICurrentUser,
} from '@library/common';
import { StorageService } from '@library/storage';

import { GarmentImage } from '@api/modules/garments/entities/garment-image.entity';
import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { PreviewModeService } from '@api/modules/settings';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';
import { toTryOnJobResponse } from '../mappers/tryon-job.mapper';

import { TryOnGuardService } from './tryon-guard.service';
import { TryOnRateLimitService } from './tryon-rate-limit.service';
import { TryOnRunnerService, type ImageRef } from './tryon-runner.service';

import type { CreateTryOnDto } from '../dto/create-tryon.dto';
import type { TryOnJobResponseDto } from '../dto/tryon-job-response.dto';

/** The snapshot written when a garment's category relation could not be resolved. */
export const UNCATEGORISED_SNAPSHOT = 'Uncategorised';

/**
 * **`POST /tryon` — the consumer request path. PRD §8.1, ARCHITECTURE §5.11.**
 *
 * The order here is the PRD's order, and every step of it is load-bearing:
 *
 * 1. **preview mode (A-31)** — an admin looking at the consumer experience must never
 *    spend a generation, so this is checked *first*, before the guard chain has a
 *    chance to refuse her for not being a consumer;
 * 2. **the guard chain (§8.1 step 3)** — ten predicates, entirely before any spend, in
 *    `TryOnGuardService`;
 * 3. **idempotent replay** — a key that already succeeded returns that job's result
 *    rather than generating again;
 * 4. **the generation (§8.1 steps 4–6)** — cache lookup, upstream, store, charge, all
 *    in `TryOnRunnerService`, which is also what the A-11 test-render path uses.
 *
 * This class deliberately holds no cache logic, no provider logic and no ledger logic.
 * It resolves *which* images are involved and hands off. That is what keeps the
 * sentence "quota and budget decrement only on success" checkable by reading one
 * method in one other file.
 */
@Injectable()
export class TryOnService {
  private readonly logger = new Logger(TryOnService.name);

  constructor(
    @InjectRepository(GarmentImage)
    private readonly garmentImages: Repository<GarmentImage>,
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    private readonly guards: TryOnGuardService,
    private readonly runner: TryOnRunnerService,
    private readonly rateLimits: TryOnRateLimitService,
    private readonly preview: PreviewModeService,
    private readonly storage: StorageService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Start a try-on.
   *
   * @param ip the client address as Express resolved it, honouring `TRUST_PROXY`. Used
   * only for the C-6 per-IP ceiling and never stored against a render (§9.3).
   */
  async create(
    dto: CreateTryOnDto,
    user: ICurrentUser | undefined,
    ip?: string,
  ): Promise<TryOnJobResponseDto> {
    // ── A-31 preview mode — no spend, no job, no ledger row ───────────────────
    if (user !== undefined && user.role === Role.ADMIN && this.preview.isPreviewActive(user.id)) {
      return this.previewResponse(dto, user);
    }

    // ── §8.1 step 3 — the guard chain, entirely before any spend ──────────────
    const authorised = await this.guards.assertMayGenerate({
      user,
      garmentId: dto.garmentId,
      ...(dto.personPhotoId === undefined ? {} : { personPhotoId: dto.personPhotoId }),
      idempotencyKey: dto.idempotencyKey,
      ...(ip === undefined ? {} : { ip }),
    });

    // ── §8.4 — a key that already succeeded replays; it never regenerates ─────
    if (authorised.completedJob !== null) {
      this.logger.debug('Replaying a completed job for a repeated idempotency key.');
      return this.describe(authorised.completedJob, authorised.user);
    }

    const source = await this.tryOnSourceOf(authorised.garment);

    // Recorded only once the request is authorised: a consumer refused for a lapsed
    // consent should not also find herself rate-limited.
    this.rateLimits.recordIpHit(ip);

    const outcome = await this.runner.run({
      userId: authorised.user.id,
      origin: JobOrigin.CONSUMER,
      idempotencyKey: dto.idempotencyKey,
      garment: authorised.garment,
      garmentImage: source,
      person: {
        storageKey: authorised.photo.storageKey,
        hash: authorised.photo.hash,
        mimeType: authorised.photo.mimeType,
      },
      personPhotoId: authorised.photo.id,
      referenceModelId: null,
      personPhotoLabel: authorised.photo.label,
      categorySnapshot: categoryNameOf(authorised.garment),
    });

    return toTryOnJobResponse(outcome.job, outcome.result, (key) =>
      this.storage.signedUrl(key, authorised.user.id),
    );
  }

  /**
   * The try-on source image of a garment — the file that goes upstream and half of the
   * §3.7 cache key.
   *
   * A published garment always has one (the A-9 publish gate refuses otherwise), so
   * reaching the throw means the source was deleted after publication. `409
   * TRYON_SOURCE_REQUIRED` is the honest answer: nothing is wrong with the request.
   */
  private async tryOnSourceOf(garment: Garment): Promise<ImageRef> {
    const source = await this.garmentImages.findOne({
      where: { garmentId: garment.id, isTryOnSource: true },
    });

    if (source === null) {
      throw new ConflictException(ErrorCode.TRYON_SOURCE_REQUIRED);
    }

    return { storageKey: source.storageKey, hash: source.hash, mimeType: source.mimeType };
  }

  /**
   * A-31 — the consumer experience without spending a generation.
   *
   * The canned render is the garment's own **approved test render**, which A-11
   * guarantees every published piece has. That is a better answer than a placeholder:
   * it is a real render of the real garment, so the admin is looking at what a consumer
   * would see, and it costs nothing because it already exists.
   *
   * No `tryon_jobs` row, no `tryon_results` row, no storage write and no ledger entry.
   */
  private async previewResponse(
    dto: CreateTryOnDto,
    admin: ICurrentUser,
  ): Promise<TryOnJobResponseDto> {
    const result =
      (await this.results.findOne({
        where: { garmentId: dto.garmentId, isTestRender: true },
        order: { createdAt: 'DESC' },
      })) ?? null;

    if (result === null) {
      throw new NotFoundException(ErrorCode.TEST_RENDER_REQUIRED);
    }

    this.metrics.increment(METRICS.TRYON_CACHE_HIT);
    this.logger.debug('Served a preview-mode render; nothing was spent (A-31).');

    const job = this.jobs.create({
      id: result.id,
      userId: admin.id,
      garmentId: dto.garmentId,
      personPhotoId: null,
      referenceModelId: null,
      origin: JobOrigin.TEST_RENDER,
      isTestRender: true,
      idempotencyKey: dto.idempotencyKey,
      status: JobStatus.SUCCEEDED,
      cacheHit: true,
      cacheKey: result.cacheKey,
      errorCode: null,
      attempts: 0,
      batchId: null,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
      createdAt: new Date(),
    });

    return toTryOnJobResponse(job, result, (key) => this.storage.signedUrl(key, admin.id));
  }

  /** A job plus its result, as §5.11 describes it. */
  private async describe(job: TryOnJob, user: ICurrentUser): Promise<TryOnJobResponseDto> {
    const result = await this.results.findOne({ where: { jobId: job.id } });
    return toTryOnJobResponse(job, result, (key) => this.storage.signedUrl(key, user.id));
  }
}

/** `garments.category.name`, or the fallback when the relation was not loaded. */
export function categoryNameOf(garment: Garment): string {
  const name: unknown = garment.category?.name;
  return typeof name === 'string' && name.length > 0 ? name : UNCATEGORISED_SNAPSHOT;
}
