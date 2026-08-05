import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import {
  DataSource,
  In,
  Not,
  Repository,
  type EntityManager,
  type SelectQueryBuilder,
} from 'typeorm';

import {
  AppException,
  ConflictException,
  ErrorCode,
  ERROR_CODE_SPECS,
  NotFoundException,
  ValidationException,
  type ICurrentUser,
  type IPaginated,
  type SortOrder,
} from '@library/common';
import { paginate, runInTransaction } from '@library/database';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { CategoriesService } from '@api/modules/categories';
import { SettingsService } from '@api/modules/settings';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  type AuditAction,
} from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { GarmentBulkAction } from '../dto/garment-bulk.dto';
import {
  GarmentBulkItemResultDto,
  GarmentBulkResultDto,
  GarmentResponseDto,
} from '../dto/garment-response.dto';
import { GarmentImage } from '../entities/garment-image.entity';
import { Garment } from '../entities/garment.entity';
import { GarmentMode } from '../enums/garment-mode.enum';
import { PublishState } from '../enums/publish-state.enum';
import { toGarmentResponse } from '../mappers/garment.mapper';
import { MAX_GARMENT_SLUG_LENGTH, slugify, suffixedSlug } from '../utils/slug.util';

import { evaluatePublishGate, isAllowedPublishTransition } from './garment-publish.gate';

import type { CreateGarmentDto } from '../dto/create-garment.dto';
import type { DeleteGarmentDto } from '../dto/delete-garment.dto';
import type { GarmentBulkDto } from '../dto/garment-bulk.dto';
import type { GarmentQualityOverrideDto } from '../dto/garment-quality-override.dto';
import type { GarmentQueryDto } from '../dto/garment-query.dto';
import type { UpdateGarmentDto } from '../dto/update-garment.dto';

/** How many `slug`, `slug-2`, `slug-3` … candidates to try before giving up. */
const MAX_SLUG_ATTEMPTS = 50;

/** The query-builder alias every garment query in this file uses. */
const GARMENT_ALIAS = 'garment';

/**
 * **A-14 "highest star rate", in SQL.**
 *
 * The same numerator and denominator as `starRateOf()` in the mapper — love share of
 * the verdicts cast, `NULL` before the first verdict — so a page sorted by the
 * database and a row rendered by the mapper cannot disagree. A unit test pins the two
 * together.
 *
 * `1.0 *` rather than a cast: TypeORM rewrites `alias.property` inside an ORDER BY
 * string, and keeping the fragment free of `::` keeps that rewrite unambiguous.
 */
export const STAR_RATE_SQL =
  `(1.0 * ${GARMENT_ALIAS}.loveCount) / ` +
  `NULLIF(${GARMENT_ALIAS}.loveCount + ${GARMENT_ALIAS}.maybeCount + ${GARMENT_ALIAS}.rejectCount, 0)`;

/**
 * The garment record — PRD A-8, A-10, A-12 … A-14, ARCHITECTURE §5.6.
 *
 * Four things hold across every method:
 *
 * 1. **The publish gate is one function and there is no path around it.**
 *    `evaluatePublishGate()` decides whether a garment may enter `PUBLISHED`; every
 *    transition into that state — single or bulk — goes through {@link publish}, and
 *    {@link publish} calls it. A-11's promise ("no garment reaches the consumer
 *    catalog without an approved test render") is only worth anything if that is
 *    true, so bulk publish is implemented *as a loop over `publish()`* rather than as
 *    a faster bulk `UPDATE`.
 * 2. **A rental has a deposit and a sale does not.** Checked against the *merged*
 *    record on every write, because a PATCH can change `mode` without sending
 *    `deposit`.
 * 3. **Publish-state changes move the A-7 counter in the same transaction.**
 *    `categories.publishedGarmentCount` is what stops a category holding published
 *    pieces from being deleted; a counter that commits separately from the state it
 *    describes is a guard that is wrong for the duration of a crash.
 * 4. **Archiving never deletes a row (A-13).** `ARCHIVED` is a state, and the
 *    counters that feed A-36 … A-39 stay exactly where they were.
 *
 * Images and the A-10 validator are **not** here. `garment_images` writes and the
 * quality scorer live beside this file; this service only ever *reads* the try-on
 * source flag and the quality columns they maintain.
 */
@Injectable()
export class GarmentsService {
  constructor(
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(GarmentImage)
    private readonly images: Repository<GarmentImage>,
    private readonly categories: CategoriesService,
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Reads
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /admin/garments` — search, category filter, publish-state filter and the
   * three A-14 sorts.
   *
   * Unlike the public catalog this query has **no visibility predicate**: an admin is
   * supposed to see drafts and archived pieces, which is exactly why the public
   * projection lives in a different module with a different query rather than in this
   * one behind a boolean.
   */
  async list(query: GarmentQueryDto): Promise<IPaginated<GarmentResponseDto>> {
    const qb = this.garments
      .createQueryBuilder(GARMENT_ALIAS)
      .where(`${GARMENT_ALIAS}.deletedAt IS NULL`);

    if (query.categoryId !== undefined) {
      qb.andWhere(`${GARMENT_ALIAS}.categoryId = :categoryId`, { categoryId: query.categoryId });
    }
    if (query.publishState !== undefined) {
      qb.andWhere(`${GARMENT_ALIAS}.publishState = :publishState`, {
        publishState: query.publishState,
      });
    }
    if (query.mode !== undefined) {
      qb.andWhere(`${GARMENT_ALIAS}.mode = :mode`, { mode: query.mode });
    }
    if (query.flaggedForReview === true) {
      qb.andWhere(`${GARMENT_ALIAS}.flaggedForReview = true`);
    }
    if (query.search !== undefined) {
      qb.andWhere(
        `(${GARMENT_ALIAS}.title ILIKE :search OR ${GARMENT_ALIAS}.sku ILIKE :search ` +
          `OR EXISTS (SELECT 1 FROM unnest(${GARMENT_ALIAS}.styleTags) AS tag WHERE tag ILIKE :search))`,
        { search: `%${query.search}%` },
      );
    }

    this.applyOrdering(qb, query.sortBy, query.sortOrder);

    // No `sortableColumns`: ordering is already applied above, because `starRate` is a
    // derived expression and `paginate()` only knows how to order by a column.
    const page = await paginate(qb, query);

    return { items: await this.presentMany(page.items), meta: page.meta };
  }

  /** `GET /admin/garments/:garmentId` — the full record (§5.6). */
  async findOne(garmentId: string): Promise<GarmentResponseDto> {
    return this.present(await this.requireGarment(garmentId));
  }

  /* -----------------------------------------------------------------------------------------
   * Create and update
   * -------------------------------------------------------------------------------------- */

  /** `POST /admin/garments` — every A-8 field (§5.6). */
  async create(dto: CreateGarmentDto, actor: ICurrentUser): Promise<GarmentResponseDto> {
    await this.categories.requireOpenCategory(dto.categoryId);
    await this.assertSkuAvailable(dto.sku);

    const mode = dto.mode;
    const deposit = dto.deposit ?? null;
    this.assertDepositConsistent(mode, deposit);

    const garment = this.garments.create({
      sku: dto.sku,
      title: dto.title,
      titleUr: dto.titleUr ?? null,
      slug: await this.resolveSlug(dto.slug ?? dto.title),
      categoryId: dto.categoryId,
      colors: dto.colors ?? [],
      fabric: dto.fabric ?? null,
      embellishmentWeight: dto.embellishmentWeight,
      price: dto.price,
      currency: dto.currency ?? 'PKR',
      mode,
      deposit,
      description: dto.description ?? null,
      descriptionUr: dto.descriptionUr ?? null,
      sizes: dto.sizes ?? [],
      styleTags: dto.styleTags ?? [],
      // A new garment is always a draft. There is no create-and-publish shortcut,
      // because the A-11 gate needs a test render that cannot exist yet (A-13).
      publishState: PublishState.DRAFT,
      publishedAt: null,
    });

    const saved = await this.garments.save(garment);
    this.emitAudit(AUDIT_ACTIONS.GARMENT_CREATED, saved, actor, {
      categoryId: saved.categoryId,
      mode: saved.mode,
    });

    return this.present(saved);
  }

  /**
   * `PATCH /admin/garments/:garmentId` (§5.6).
   *
   * Re-categorising a **published** garment moves the A-7 counter off the old
   * category and onto the new one inside one transaction — otherwise a crash between
   * the two updates leaves one category undeletable and the other deletable while it
   * holds a live piece.
   */
  async update(
    garmentId: string,
    dto: UpdateGarmentDto,
    actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    const garment = await this.requireGarment(garmentId);
    const previousCategoryId = garment.categoryId;
    const changed: Record<string, unknown> = {};

    if (dto.categoryId !== undefined && dto.categoryId !== garment.categoryId) {
      await this.categories.requireOpenCategory(dto.categoryId);
      garment.categoryId = dto.categoryId;
      changed.categoryId = dto.categoryId;
    }
    if (dto.sku !== undefined && dto.sku !== garment.sku) {
      await this.assertSkuAvailable(dto.sku, garment.id);
      garment.sku = dto.sku;
      changed.sku = dto.sku;
    }
    if (dto.slug !== undefined) {
      garment.slug = await this.resolveSlug(dto.slug, garment.id);
      changed.slug = garment.slug;
    }
    if (dto.title !== undefined) {
      garment.title = dto.title;
      changed.title = dto.title;
    }
    if (dto.titleUr !== undefined) {
      garment.titleUr = dto.titleUr;
    }
    if (dto.colors !== undefined) {
      garment.colors = dto.colors;
    }
    if (dto.fabric !== undefined) {
      garment.fabric = dto.fabric;
    }
    if (dto.embellishmentWeight !== undefined) {
      garment.embellishmentWeight = dto.embellishmentWeight;
      changed.embellishmentWeight = dto.embellishmentWeight;
    }
    if (dto.price !== undefined) {
      garment.price = dto.price;
      changed.price = dto.price;
    }
    if (dto.currency !== undefined) {
      garment.currency = dto.currency;
    }
    if (dto.mode !== undefined) {
      garment.mode = dto.mode;
      changed.mode = dto.mode;
    }
    if (dto.deposit !== undefined) {
      garment.deposit = dto.deposit;
    }
    if (dto.description !== undefined) {
      garment.description = dto.description;
    }
    if (dto.descriptionUr !== undefined) {
      garment.descriptionUr = dto.descriptionUr;
    }
    if (dto.sizes !== undefined) {
      garment.sizes = dto.sizes;
    }
    if (dto.styleTags !== undefined) {
      garment.styleTags = dto.styleTags;
    }

    // Against the merged record: `mode` and `deposit` may arrive in different requests.
    this.assertDepositConsistent(garment.mode, garment.deposit);

    const recategorised = garment.categoryId !== previousCategoryId;
    const movesCounter = recategorised && garment.publishState === PublishState.PUBLISHED;

    const saved = movesCounter
      ? await runInTransaction(
          this.dataSource,
          async (manager: EntityManager): Promise<Garment> => {
            const stored = await manager.getRepository(Garment).save(garment);
            await this.categories.applyPublishedGarmentDelta(manager, previousCategoryId, -1);
            await this.categories.applyPublishedGarmentDelta(manager, stored.categoryId, 1);
            return stored;
          },
          { label: 'garments.update.recategorise' },
        )
      : await this.garments.save(garment);

    this.emitAudit(AUDIT_ACTIONS.GARMENT_UPDATED, saved, actor, changed);
    if (recategorised) {
      this.emitAudit(AUDIT_ACTIONS.GARMENT_RECATEGORISED, saved, actor, {
        fromCategoryId: previousCategoryId,
        toCategoryId: saved.categoryId,
      });
    }

    return this.present(saved);
  }

  /**
   * `DELETE /admin/garments/:garmentId` — requires typing the title (D-17).
   *
   * A soft delete. The row stays so that the `RESTRICT` foreign keys pointing at it
   * from `tryon_results` and `enquiry_items` remain satisfiable and the analytics
   * history A-13 promises survives; the unique indexes on `sku` and `slug` carry
   * `WHERE "deletedAt" IS NULL`, so both values become reusable immediately.
   */
  async remove(garmentId: string, dto: DeleteGarmentDto, actor: ICurrentUser): Promise<void> {
    const garment = await this.requireGarment(garmentId);

    if (dto.confirmTitle.trim().toLowerCase() !== garment.title.trim().toLowerCase()) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'Type the title of this piece exactly to confirm.',
        errors: [
          {
            field: 'confirmTitle',
            message: 'confirmTitle does not match the garment title',
            code: 'CONFIRM_TITLE_MISMATCH',
          },
        ],
      });
    }

    const wasPublished = garment.publishState === PublishState.PUBLISHED;

    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        await manager.getRepository(Garment).softDelete(garment.id);
        if (wasPublished) {
          await this.categories.applyPublishedGarmentDelta(manager, garment.categoryId, -1);
        }
      },
      { label: 'garments.remove' },
    );

    this.emitAudit(AUDIT_ACTIONS.GARMENT_DELETED, garment, actor, {
      publishState: garment.publishState,
      categoryId: garment.categoryId,
    });
  }

  /* -----------------------------------------------------------------------------------------
   * The publish state machine (A-13)
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /admin/garments/:garmentId/publish` — **the A-11 and A-10 gates**.
   *
   * Refuses with `TEST_RENDER_REQUIRED` when the garment carries no approved test
   * render, and with `QUALITY_OVERRIDE_REQUIRED` when its quality score is below
   * `quality.minScore` and no override has been recorded. Neither can be skipped:
   * this is the only method in the module that writes `publishState = PUBLISHED`.
   */
  async publish(garmentId: string, actor: ICurrentUser): Promise<GarmentResponseDto> {
    const garment = await this.requireGarment(garmentId);
    this.assertTransition(garment, PublishState.PUBLISHED);

    const refusal = evaluatePublishGate({
      garment,
      hasTryOnSource: await this.hasTryOnSource(garment.id),
      minQualityScore: await this.minQualityScore(),
    });

    if (refusal !== null) {
      throw new ConflictException(refusal, {
        // The spec's status is authoritative (§2.5); `ConflictException` fixes the
        // code family, never the status.
        details: {
          garmentId: garment.id,
          testRenderState: garment.testRenderState,
          qualityScore: garment.qualityScore,
          checks: garment.qualityChecks ?? [],
        },
      });
    }

    const from = garment.publishState;
    const publishedAt = new Date();

    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        await manager
          .getRepository(Garment)
          .update({ id: garment.id }, { publishState: PublishState.PUBLISHED, publishedAt });
        await this.categories.applyPublishedGarmentDelta(manager, garment.categoryId, 1);
      },
      { label: 'garments.publish' },
    );

    garment.publishState = PublishState.PUBLISHED;
    garment.publishedAt = publishedAt;

    this.emitAudit(AUDIT_ACTIONS.GARMENT_PUBLISHED, garment, actor, {
      from,
      to: PublishState.PUBLISHED,
      qualityScore: garment.qualityScore,
      qualityOverridden: garment.qualityOverriddenBy !== null,
    });

    return this.present(garment);
  }

  /** `POST /admin/garments/:garmentId/unpublish` — back to draft (§5.6). */
  async unpublish(garmentId: string, actor: ICurrentUser): Promise<GarmentResponseDto> {
    return this.leavePublished(
      garmentId,
      PublishState.DRAFT,
      AUDIT_ACTIONS.GARMENT_UNPUBLISHED,
      actor,
    );
  }

  /**
   * `POST /admin/garments/:garmentId/archive` — **A-13**.
   *
   * > "Archived garments retain analytics history."
   *
   * So this changes one column. No row is removed, no counter is reset, and
   * `publishedAt` is left where it is — an archived piece's history is the record of
   * a piece that *was* live, and blanking the date would erase that.
   */
  async archive(garmentId: string, actor: ICurrentUser): Promise<GarmentResponseDto> {
    return this.leavePublished(
      garmentId,
      PublishState.ARCHIVED,
      AUDIT_ACTIONS.GARMENT_ARCHIVED,
      actor,
    );
  }

  /**
   * `POST /admin/garments/:garmentId/quality-override` — **A-10**.
   *
   * Records the override and its reason; it publishes nothing. The next
   * {@link publish} then finds `hasQualityOverride` true and lets the A-10 objection
   * pass — while the A-11 test-render gate still applies, because a bad photograph
   * and an unproven try-on are different failures and one waiver must not clear both.
   */
  async recordQualityOverride(
    garmentId: string,
    dto: GarmentQualityOverrideDto,
    actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    const garment = await this.requireGarment(garmentId);

    garment.qualityOverriddenBy = actor.id;
    garment.qualityOverriddenAt = new Date();
    const saved = await this.garments.save(garment);

    this.emitAudit(AUDIT_ACTIONS.GARMENT_QUALITY_OVERRIDDEN, saved, actor, {
      reason: dto.reason,
      qualityScore: saved.qualityScore,
      minQualityScore: await this.minQualityScore(),
    });

    return this.present(saved);
  }

  /**
   * `POST /admin/garments/bulk` — A-12, D-16.
   *
   * A loop over the single-garment methods, on purpose. A bulk `UPDATE … WHERE id IN
   * (…)` would be one round trip and would also be a second way into `PUBLISHED` that
   * does not consult the A-11 gate. Per-item results are what D-16 asks for anyway,
   * and they are only producible by attempting each item.
   */
  async bulk(dto: GarmentBulkDto, actor: ICurrentUser): Promise<GarmentBulkResultDto> {
    const results: GarmentBulkItemResultDto[] = [];

    for (const garmentId of dto.garmentIds) {
      results.push(await this.applyBulkAction(dto, garmentId, actor));
    }

    const succeeded = results.filter((result) => result.succeeded).length;

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.GARMENT_BULK_ACTION_APPLIED,
        targetType: AUDIT_TARGET_TYPES.GARMENT,
        actorId: actor.id,
        actorRole: actor.role,
        targetLabel: dto.action,
        metadata: {
          bulkAction: dto.action,
          requested: dto.garmentIds.length,
          succeeded,
          failed: dto.garmentIds.length - succeeded,
        },
      }),
    );

    const response = new GarmentBulkResultDto();
    response.requested = dto.garmentIds.length;
    response.succeeded = succeeded;
    response.failed = dto.garmentIds.length - succeeded;
    response.results = results;
    return response;
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async applyBulkAction(
    dto: GarmentBulkDto,
    garmentId: string,
    actor: ICurrentUser,
  ): Promise<GarmentBulkItemResultDto> {
    const result = new GarmentBulkItemResultDto();
    result.garmentId = garmentId;

    try {
      switch (dto.action) {
        case GarmentBulkAction.PUBLISH:
          await this.publish(garmentId, actor);
          break;
        case GarmentBulkAction.UNPUBLISH:
          await this.unpublish(garmentId, actor);
          break;
        case GarmentBulkAction.ARCHIVE:
          await this.archive(garmentId, actor);
          break;
        case GarmentBulkAction.RECATEGORISE:
          await this.update(garmentId, { categoryId: dto.categoryId }, actor);
          break;
      }

      result.succeeded = true;
      result.errorCode = null;
      result.message = null;
      return result;
    } catch (error) {
      // Only a domain refusal becomes a per-item result. An unexpected error is a
      // genuine failure of the request and must not be flattened into "item 7 didn't
      // go through" (§2.5).
      if (!(error instanceof AppException)) {
        throw error;
      }

      result.succeeded = false;
      result.errorCode = error.errorCode;
      result.message = ERROR_CODE_SPECS[error.errorCode].message;
      return result;
    }
  }

  /** `PUBLISHED → DRAFT` and `PUBLISHED → ARCHIVED` differ only in the target state. */
  private async leavePublished(
    garmentId: string,
    to: PublishState,
    action: AuditAction,
    actor: ICurrentUser,
  ): Promise<GarmentResponseDto> {
    const garment = await this.requireGarment(garmentId);
    this.assertTransition(garment, to);

    const from = garment.publishState;

    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        await manager.getRepository(Garment).update({ id: garment.id }, { publishState: to });
        await this.categories.applyPublishedGarmentDelta(manager, garment.categoryId, -1);
      },
      { label: 'garments.leavePublished' },
    );

    garment.publishState = to;
    this.emitAudit(action, garment, actor, { from, to });

    return this.present(garment);
  }

  private assertTransition(garment: Garment, to: PublishState): void {
    if (!isAllowedPublishTransition(garment.publishState, to)) {
      throw new ConflictException(ErrorCode.INVALID_PUBLISH_TRANSITION, {
        message: `A piece can't move from ${garment.publishState} to ${to}.`,
        details: { garmentId: garment.id, from: garment.publishState, to },
      });
    }
  }

  /** §4.13: `deposit` is required when `mode = RENTAL`, and meaningless otherwise. */
  private assertDepositConsistent(mode: GarmentMode, deposit: number | null): void {
    if (mode === GarmentMode.RENTAL && deposit === null) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'A rental piece needs a deposit.',
        errors: [
          {
            field: 'deposit',
            message: 'deposit is required when mode is RENTAL',
            code: 'REQUIRED',
          },
        ],
      });
    }

    if (mode === GarmentMode.SALE && deposit !== null) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'A piece for sale does not take a deposit.',
        errors: [
          {
            field: 'deposit',
            message: 'deposit is only valid when mode is RENTAL',
            code: 'NOT_APPLICABLE',
          },
        ],
      });
    }
  }

  private async requireGarment(garmentId: string): Promise<Garment> {
    const garment = await this.garments.findOne({ where: { id: garmentId } });
    if (garment === null) {
      throw new NotFoundException(ErrorCode.GARMENT_NOT_FOUND);
    }
    return garment;
  }

  private async assertSkuAvailable(sku: string, excludeId?: string): Promise<void> {
    const clash = await this.garments.findOne({
      where: excludeId === undefined ? { sku } : { sku, id: Not(excludeId) },
    });

    if (clash !== null) {
      throw new ConflictException(ErrorCode.GARMENT_SKU_EXISTS, { details: { sku } });
    }
  }

  /** A-9 / §4.14 — exactly one image per garment may carry `isTryOnSource`. */
  private async hasTryOnSource(garmentId: string): Promise<boolean> {
    return this.images.exists({ where: { garmentId, isTryOnSource: true } });
  }

  /** A-10 — read through the cached settings getter, never from the table (§4.28). */
  private async minQualityScore(): Promise<number> {
    return this.settings.getNumber(SETTINGS_KEYS.QUALITY_MIN_SCORE);
  }

  /** A-14's three sorts, plus a stable tie-breaker so rows cannot swap between pages. */
  private applyOrdering(
    qb: SelectQueryBuilder<Garment>,
    sortBy: string,
    sortOrder: SortOrder,
  ): void {
    const direction: SortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

    if (sortBy === 'starRate') {
      // NULLS LAST in both directions: "not rated yet" is not a low rating, and it is
      // never the answer to "show me the best" or "show me the worst".
      qb.orderBy(STAR_RATE_SQL, direction, 'NULLS LAST');
    } else {
      qb.orderBy(`${GARMENT_ALIAS}.${sortBy}`, direction, 'NULLS LAST');
    }

    qb.addOrderBy(`${GARMENT_ALIAS}.id`, direction);
  }

  private async present(garment: Garment): Promise<GarmentResponseDto> {
    const [category, hasSource, minQualityScore] = await Promise.all([
      this.categories.findById(garment.categoryId),
      this.hasTryOnSource(garment.id),
      this.minQualityScore(),
    ]);

    const publishable =
      evaluatePublishGate({ garment, hasTryOnSource: hasSource, minQualityScore }) === null;

    return toGarmentResponse(garment, category?.name ?? null, publishable);
  }

  /**
   * A set of already-selected rows → DTOs.
   *
   * Public so `CatalogHealthService` (A-15) presents its cohort samples through this
   * mapper rather than a second one. A health row and a catalog-list row are the same
   * piece; if the two were built separately they would eventually disagree about
   * `publishable`, which is exactly the field the console uses to decide whether the
   * remedy it is linking to has already been applied.
   *
   * It takes rows rather than a query on purpose: the selection is the caller's
   * business, and this class has no way to bound one it did not write.
   */
  async presentRows(rows: readonly Garment[]): Promise<GarmentResponseDto[]> {
    return this.presentMany(rows);
  }

  /**
   * A page of rows → a page of DTOs, in three queries rather than three per row.
   *
   * The list screen is the one most likely to be opened at `limit=100`, so the
   * category names and the try-on-source flags are resolved for the whole page at
   * once and the settings getter is read from cache.
   */
  private async presentMany(rows: readonly Garment[]): Promise<GarmentResponseDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const garmentIds = rows.map((row) => row.id);
    const [categories, sources, minQualityScore] = await Promise.all([
      this.categories.findByIds(rows.map((row) => row.categoryId)),
      this.images.find({ where: { garmentId: In(garmentIds), isTryOnSource: true } }),
      this.minQualityScore(),
    ]);

    const withSource = new Set(sources.map((image) => image.garmentId));

    return rows.map((garment) =>
      toGarmentResponse(
        garment,
        categories.get(garment.categoryId)?.name ?? null,
        evaluatePublishGate({
          garment,
          hasTryOnSource: withSource.has(garment.id),
          minQualityScore,
        }) === null,
      ),
    );
  }

  /**
   * A unique slug, ignoring the row being updated.
   *
   * The unique index carries `WHERE "deletedAt" IS NULL`, so a soft-deleted garment
   * does not reserve its slug; the lookup matches that by not asking for deleted rows.
   */
  private async resolveSlug(stem: string, excludeId?: string): Promise<string> {
    const base = slugify(stem, MAX_GARMENT_SLUG_LENGTH);
    if (base === '') {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'Give this piece a title with at least one Latin letter or digit.',
        errors: [{ field: 'slug', message: 'slug could not be derived', code: 'SLUG_EMPTY' }],
      });
    }

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const candidate = suffixedSlug(base, attempt, MAX_GARMENT_SLUG_LENGTH);
      const clash = await this.garments.findOne({
        where:
          excludeId === undefined ? { slug: candidate } : { slug: candidate, id: Not(excludeId) },
      });
      if (clash === null) {
        return candidate;
      }
    }

    throw new ConflictException(ErrorCode.RESOURCE_CONFLICT, {
      message: 'Too many pieces share this title. Give this one a distinct title.',
    });
  }

  /** A-3 — catalog changes, publishes and deletions are audited (§2.9 rule 4). */
  private emitAudit(
    action: AuditAction,
    garment: Garment,
    actor: ICurrentUser,
    metadata: Record<string, unknown>,
  ): void {
    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action,
        targetType: AUDIT_TARGET_TYPES.GARMENT,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: garment.id,
        targetLabel: garment.title,
        metadata: { garmentSlug: garment.slug, ...metadata },
      }),
    );
  }
}
