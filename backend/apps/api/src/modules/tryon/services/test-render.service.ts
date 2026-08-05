import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { ErrorCode, NotFoundException, type ICurrentUser } from '@library/common';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { hasApprovedTestRender } from '@api/modules/garments';
import { GarmentImage } from '@api/modules/garments/entities/garment-image.entity';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TestRenderState } from '@api/modules/garments/enums/test-render-state.enum';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { TryOnJob } from '../entities/tryon-job.entity';
import { JobOrigin } from '../enums/job-origin.enum';
import { JobStatus } from '../enums/job-status.enum';
import { QUOTA_PORT, type QuotaPort } from '../ports/quota.port';

import { ReferenceModelsService } from './reference-models.service';
import { TryOnRunnerService, type GenerationRequest } from './tryon-runner.service';
import { categoryNameOf } from './tryon.service';

import type {
  TestRenderBatchItemDto,
  TestRenderBatchResponseDto,
  TestRenderEstimateResponseDto,
  TestRenderResponseDto,
} from '../dto/test-render-response.dto';
import type {
  BulkTestRenderDto,
  RejectTestRenderDto,
  RunTestRenderDto,
  TestRenderEstimateDto,
} from '../dto/test-render.dto';

/**
 * **The A-11 test-render gate.**
 *
 * > "Before publishing, an Admin runs one try-on against a built-in reference model
 * > photo. The result is shown beside the source image for approval and stored on the
 * > garment. No garment reaches the consumer catalog without an approved test render."
 *
 * Three things this service is careful about:
 *
 * **It never touches a consumer photo.** The person image comes from
 * `reference_models` (§4.15) and the job records it in `referenceModelId`, a different
 * column from `personPhotoId`. There is no branch here that could reach `person_photos`
 * at all (S-10).
 *
 * **Admin work is tracked separately from consumer demand** (§8.4). Every job it
 * creates carries `origin = TEST_RENDER` and `isTestRender = true`, so the charge lands
 * in `usage_ledger` under `TEST_RENDER` and consumes **no** consumer's quota — which is
 * what lets A-33 split the burn-rate chart honestly.
 *
 * **Approval is a separate, audited act.** Running a render sets `PENDING`; only
 * `approve()` sets `APPROVED` with a timestamp and an approver, and only that pair
 * unblocks publishing — `hasApprovedTestRender()` in the garments module requires both
 * columns, and E-10 asserts nothing lacking them reaches the catalogue.
 */
@Injectable()
export class TestRenderService {
  private readonly logger = new Logger(TestRenderService.name);

  constructor(
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(GarmentImage)
    private readonly garmentImages: Repository<GarmentImage>,
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    @Inject(QUOTA_PORT)
    private readonly quota: QuotaPort,
    private readonly referenceModels: ReferenceModelsService,
    private readonly runner: TryOnRunnerService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * One render (A-11)
   * -------------------------------------------------------------------------------------- */

  /** `POST /admin/tryon/test-render` — run one, synchronously, and store it (§5.11). */
  async run(dto: RunTestRenderDto, admin: ICurrentUser): Promise<TestRenderResponseDto> {
    const request = await this.buildRequest(dto.garmentId, admin.id, dto.referenceModelId);

    const outcome = await this.runner.run(request);

    await this.garments.update(
      { id: request.garment.id },
      {
        testRenderId: outcome.result.id,
        // Rendered is not approved. An admin still has to look at it (A-11).
        testRenderState: TestRenderState.PENDING,
        testRenderApprovedAt: null,
        approvedBy: null,
      },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.GARMENT_TEST_RENDER_RUN,
        targetType: AUDIT_TARGET_TYPES.GARMENT,
        actorId: admin.id,
        actorRole: admin.role,
        targetId: request.garment.id,
        targetLabel: request.garment.title,
        metadata: { jobId: outcome.job.id, cacheHit: outcome.cacheHit },
      }),
    );

    return this.describe(request.garment.id);
  }

  /** `POST /admin/garments/:garmentId/test-render/approve` — A-11, unblocks publishing. */
  async approve(garmentId: string, admin: ICurrentUser): Promise<TestRenderResponseDto> {
    const garment = await this.loadGarment(garmentId);

    if (garment.testRenderId === null) {
      throw new NotFoundException(ErrorCode.TEST_RENDER_REQUIRED);
    }

    await this.garments.update(
      { id: garment.id },
      {
        testRenderState: TestRenderState.APPROVED,
        // Both columns, always. `hasApprovedTestRender()` requires the pair, precisely
        // so a half-applied migration or a hand-edited row cannot pass the gate.
        testRenderApprovedAt: new Date(),
        approvedBy: admin.id,
      },
    );

    this.emitAudit(AUDIT_ACTIONS.GARMENT_TEST_RENDER_APPROVED, garment, admin);

    return this.describe(garment.id);
  }

  /** `POST /admin/garments/:garmentId/test-render/reject` — the piece stays unpublishable. */
  async reject(
    garmentId: string,
    dto: RejectTestRenderDto,
    admin: ICurrentUser,
  ): Promise<TestRenderResponseDto> {
    const garment = await this.loadGarment(garmentId);

    await this.garments.update(
      { id: garment.id },
      {
        testRenderState: TestRenderState.REJECTED,
        testRenderApprovedAt: null,
        approvedBy: null,
      },
    );

    this.emitAudit(AUDIT_ACTIONS.GARMENT_TEST_RENDER_REJECTED, garment, admin, {
      reason: dto.reason,
    });

    return this.describe(garment.id);
  }

  /** The A-11 approval screen: the render beside the source, and the state (§5.11). */
  async describe(garmentId: string): Promise<TestRenderResponseDto> {
    const garment = await this.loadGarment(garmentId);

    const [source, result, job] = await Promise.all([
      this.garmentImages.findOne({ where: { garmentId, isTryOnSource: true } }),
      garment.testRenderId === null
        ? Promise.resolve(null)
        : this.results.findOne({ where: { id: garment.testRenderId } }),
      this.jobs.findOne({
        where: { garmentId, origin: JobOrigin.TEST_RENDER },
        order: { createdAt: 'DESC' },
      }),
    ]);

    return {
      garmentId,
      jobId: job?.id ?? null,
      resultId: result?.id ?? null,
      testRenderState: garment.testRenderState,
      sourceUrl: source === null ? null : this.storage.signedUrl(source.storageKey),
      // The render of a reference model, not of a person — no subject scoping needed.
      renderUrl: result === null ? null : this.storage.signedUrl(result.storageKey),
      publishable: hasApprovedTestRender(garment),
      errorCode: job?.errorCode ?? null,
    };
  }

  /* -----------------------------------------------------------------------------------------
   * Bulk (A-12, §8.2)
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /admin/tryon/test-render/bulk` — queue a batch and return immediately.
   *
   * The rows are written up front as `QUEUED` with a shared `batchId`, which makes the
   * batch durable and its progress a query (`IDX_tryon_jobs_batchId`) rather than a
   * process-local list. `TestRenderProcessor` then runs them **at concurrency one**
   * (§8.2), so catalogue work never competes with a live consumer generation.
   */
  async queueBulk(dto: BulkTestRenderDto, admin: ICurrentUser): Promise<{ batchId: string }> {
    const batchId = randomUUID();
    const model = await this.referenceModels.resolve(dto.referenceModelId);

    const garments = await this.garments.find({ where: { id: In(dto.garmentIds) } });

    const rows = garments.map((garment) =>
      this.jobs.create({
        userId: admin.id,
        garmentId: garment.id,
        personPhotoId: null,
        referenceModelId: model.id,
        origin: JobOrigin.TEST_RENDER,
        isTestRender: true,
        // Deterministic, so re-queuing the same batch cannot double-charge: the
        // unique index on (userId, idempotencyKey) refuses the second insert.
        idempotencyKey: `batch:${batchId.slice(0, 8)}:${garment.id.slice(0, 8)}`,
        status: JobStatus.QUEUED,
        cacheHit: false,
        cacheKey: null,
        errorCode: null,
        attempts: 0,
        batchId,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
      }),
    );

    await this.jobs.save(rows);

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.GARMENT_BULK_ACTION_APPLIED,
        targetType: AUDIT_TARGET_TYPES.TRYON_JOB,
        actorId: admin.id,
        actorRole: admin.role,
        targetId: batchId,
        targetLabel: `Bulk test render — ${rows.length} pieces`,
        metadata: { batchId, count: rows.length },
      }),
    );

    this.logger.log(`Queued ${rows.length} test renders at concurrency 1 (A-12, §8.2).`);

    return { batchId };
  }

  /** `GET /admin/tryon/batches/:batchId` — per-item progress and a summary (D-16). */
  async batch(batchId: string): Promise<TestRenderBatchResponseDto> {
    const jobs = await this.jobs.find({ where: { batchId } });

    if (jobs.length === 0) {
      throw new NotFoundException(ErrorCode.JOB_NOT_FOUND);
    }

    const items: TestRenderBatchItemDto[] = jobs.map((job) => ({
      garmentId: job.garmentId ?? '',
      jobId: job.id,
      status: job.status,
      errorCode: job.errorCode,
    }));

    const succeeded = jobs.filter((job) => job.status === JobStatus.SUCCEEDED).length;
    const failed = jobs.filter((job) => job.status === JobStatus.FAILED).length;

    return {
      batchId,
      total: jobs.length,
      succeeded,
      failed,
      pending: jobs.length - succeeded - failed,
      items,
    };
  }

  /**
   * `POST /admin/garments/bulk/estimate` — A-12's "cost estimate shown and confirmed
   * before it runs".
   *
   * Garments that already carry an approved render are excluded from the count: paying
   * to re-render them would spend budget to learn nothing.
   */
  async estimate(dto: TestRenderEstimateDto): Promise<TestRenderEstimateResponseDto> {
    const [garments, budget] = await Promise.all([
      this.garments.find({ where: { id: In(dto.garmentIds) } }),
      // The non-refusing read: an admin planning a batch needs the number even when
      // the budget is already spent.
      this.quota.budgetSnapshot(),
    ]);

    const alreadyApproved = garments.filter((garment) => hasApprovedTestRender(garment)).length;
    const generations = garments.length - alreadyApproved;

    return {
      selected: garments.length,
      generations,
      alreadyApproved,
      budgetRemaining: budget.remaining,
      withinBudget: generations <= budget.remaining,
    };
  }

  /* -----------------------------------------------------------------------------------------
   * Shared
   * -------------------------------------------------------------------------------------- */

  /**
   * Assembles the generation request for one garment.
   *
   * Exposed to the processor so a queued batch item is executed by exactly the same
   * code as a single interactive run — the only difference is `existingJobId`.
   */
  async buildRequest(
    garmentId: string,
    adminId: string,
    referenceModelId?: string,
    options: { batchId?: string; existingJobId?: string } = {},
  ): Promise<GenerationRequest> {
    const garment = await this.loadGarment(garmentId);
    const source = await this.garmentImages.findOne({
      where: { garmentId, isTryOnSource: true },
    });

    if (source === null) {
      // A-9: there is nothing to send upstream. Refusing here is what stops the test
      // render from being the thing that discovers it.
      throw new NotFoundException(ErrorCode.TRYON_SOURCE_REQUIRED);
    }

    const model = await this.referenceModels.resolve(referenceModelId);

    return {
      userId: adminId,
      origin: JobOrigin.TEST_RENDER,
      idempotencyKey:
        options.existingJobId === undefined
          ? `test:${garmentId.slice(0, 8)}:${Date.now().toString(36)}`
          : `adopted:${options.existingJobId.slice(0, 8)}`,
      garment,
      garmentImage: {
        storageKey: source.storageKey,
        hash: source.hash,
        mimeType: source.mimeType,
      },
      person: {
        storageKey: model.storageKey,
        hash: model.hash,
        // §3.3 seeds reference models as jpg.
        mimeType: 'image/jpeg',
      },
      personPhotoId: null,
      referenceModelId: model.id,
      personPhotoLabel: model.label,
      categorySnapshot: categoryNameOf(garment),
      batchId: options.batchId ?? null,
      ...(options.existingJobId === undefined ? {} : { existingJobId: options.existingJobId }),
    };
  }

  private async loadGarment(garmentId: string): Promise<Garment> {
    const garment = await this.garments.findOne({
      where: { id: garmentId },
      relations: { category: true },
    });

    if (garment === null) {
      throw new NotFoundException(ErrorCode.GARMENT_NOT_FOUND);
    }
    return garment;
  }

  private emitAudit(
    action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    garment: Garment,
    admin: ICurrentUser,
    metadata: Record<string, unknown> = {},
  ): void {
    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action,
        targetType: AUDIT_TARGET_TYPES.GARMENT,
        actorId: admin.id,
        actorRole: admin.role,
        targetId: garment.id,
        targetLabel: garment.title,
        metadata,
      }),
    );
  }
}
