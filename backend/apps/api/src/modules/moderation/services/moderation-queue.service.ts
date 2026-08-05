import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  NotFoundException,
  paginate,
  paginationSkip,
  RequestContext,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { StorageService } from '@library/storage';

import { AuditService } from '@api/modules/audit/services/audit.service';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { JobStatus } from '@api/modules/tryon/enums/job-status.enum';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { MODERATION_PHOTO_COLUMNS } from '../constants/moderation.constants';
import { ModerationItem } from '../entities/moderation-item.entity';
import { ModerationState } from '../enums/moderation-state.enum';
import { toModerationItemResponse, type ModerationPhotoFacts } from '../mappers/moderation.mapper';

import type { ModerationItemResponseDto } from '../dto/moderation-item-response.dto';
import type { ModerationQueryDto } from '../dto/moderation-query.dto';
import type { ReviewModerationItemDto } from '../dto/review-moderation.dto';

/** What one review decided, for the audit row and the caller. */
interface ReviewOutcome {
  readonly item: ModerationItem;
  readonly photoState: PhotoModerationState | null;
  /** The blocked generation this decision settled, when there was one. */
  readonly jobSettled: string | null;
}

/**
 * **The A-34 moderation queue — PRD A-34, S-10, §9.3 · ARCHITECTURE §4.29, §5.17.**
 *
 * > "Moderation queue for consumer photos flagged upstream or by internal heuristics.
 * > Blocked pending review, **shown blurred**, **Admin only**, **every view
 * > audit-logged**."
 *
 * Three constraints, and each of them is structural here rather than procedural.
 *
 * ### 1. Blurred, and provably so
 *
 * The queue reads `person_photos` through {@link MODERATION_PHOTO_COLUMNS}, an explicit
 * column list that **does not contain `storageKey`**. So the original photograph's key
 * is never loaded into this process at all — not filtered on the way out, not omitted
 * from a DTO, not present. The only image reachable from anything this service returns
 * is `thumbnails/person-blurred/<uuid>-160.webp`, produced at upload time by
 * `ImageService.toBlurredModerationThumbnail()` (§3.6: blur first, downscale second,
 * so it cannot be sharpened back).
 *
 * That is the difference between "we remembered not to include it" and "there is
 * nothing to include", and it is the difference S-10 is asking for. The spec beside
 * this file asserts it directly.
 *
 * ### 2. Admin only
 *
 * Every route into this service carries `@Roles(Role.ADMIN)`, and `npm run check:guards`
 * refuses a handler that does not.
 *
 * ### 3. Every view audit-logged — on the read path, not beside it
 *
 * `AuditService.record()` is **awaited before the rows are returned**. Not an event,
 * not a fire-and-forget listener: §4.29 says every read of the list *and* every read of
 * a blurred thumbnail writes `MODERATION_ITEM_VIEWED`, and §9.3 lists "moderation queue
 * access is audit-logged" as a privacy control. A control that is dropped when the
 * audit write fails is not a control. `AuditService`'s own contract sanctions this —
 * it documents `record()` as existing precisely for "a moderation-queue view, which
 * A-34 audits as part of the read itself" — and it is the one place in the codebase
 * where an audit failure is allowed to fail the request.
 *
 * The audit row carries the item ids viewed and the filter, never a storage key, never
 * a thumbnail URL and never a consumer's name (E-12).
 */
@Injectable()
export class ModerationQueueService {
  private readonly logger = new Logger(ModerationQueueService.name);

  constructor(
    @InjectRepository(ModerationItem)
    private readonly items: Repository<ModerationItem>,
    @InjectRepository(PersonPhoto)
    private readonly photos: Repository<PersonPhoto>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Reads — every one of them audited
   * -------------------------------------------------------------------------------------- */

  /** `GET /admin/moderation` (A-34, §5.17). */
  async list(
    admin: ICurrentUser,
    query: ModerationQueryDto,
  ): Promise<IPaginated<ModerationItemResponseDto>> {
    const state = query.state ?? ModerationState.PENDING;

    const [rows, total] = await this.items.findAndCount({
      where: {
        state,
        ...(query.source === undefined ? {} : { source: query.source }),
      },
      // `sortBy` came through `@IsIn(MODERATION_SORT_KEYS)`, so this index is over an
      // allow-listed key and never over client-supplied text (§2.8).
      order: { [query.sortBy]: query.sortOrder, id: query.sortOrder },
      skip: paginationSkip(query),
      take: query.limit,
    });

    // A-34 / §9.3. Awaited: the rows are not returned until the row recording that
    // they were returned has landed.
    await this.audit.record({
      action: AUDIT_ACTIONS.MODERATION_QUEUE_VIEWED,
      targetType: AUDIT_TARGET_TYPES.MODERATION_ITEM,
      actorId: admin.id,
      actorRole: admin.role,
      targetLabel: `${state} queue`,
      metadata: {
        state,
        source: query.source ?? null,
        page: query.page,
        returned: rows.length,
        itemIds: rows.map((row) => row.id),
      },
      requestId: RequestContext.getTraceId() ?? null,
    });

    const facts = await this.photoFactsFor(rows);
    const now = new Date();

    return paginate(
      rows.map((row) =>
        toModerationItemResponse(
          row,
          row.personPhotoId === null ? null : (facts.get(row.personPhotoId) ?? null),
          admin.id,
          (key, adminId) => this.storage.signedUrl(key, adminId),
          now,
        ),
      ),
      query,
      total,
    );
  }

  /**
   * `GET /admin/moderation/:itemId` (A-34, §5.17).
   *
   * This is the read that hands over a signed thumbnail URL, so it writes
   * `MODERATION_ITEM_VIEWED` — the per-thumbnail audit §4.29 asks for. The `files`
   * route writes a second one when the bytes are actually fetched; two rows for one
   * decision is the correct outcome, because a token issued and a token redeemed are
   * different facts.
   */
  async findOne(admin: ICurrentUser, itemId: string): Promise<ModerationItemResponseDto> {
    const item = await this.require(itemId);

    await this.audit.record({
      action: AUDIT_ACTIONS.MODERATION_ITEM_VIEWED,
      targetType: AUDIT_TARGET_TYPES.MODERATION_ITEM,
      actorId: admin.id,
      actorRole: admin.role,
      targetId: item.id,
      targetLabel: item.reasonCode,
      metadata: {
        state: item.state,
        source: item.source,
        // Whether a blurred derivative exists, never the key itself (E-12).
        hasBlurredThumbnail: item.blurredThumbnailKey !== null,
      },
      requestId: RequestContext.getTraceId() ?? null,
    });

    return this.present(item, admin);
  }

  /* -----------------------------------------------------------------------------------------
   * Decisions
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /admin/moderation/:itemId/approve` — release the photograph for generation.
   *
   * Three tables move together, so they move inside one transaction (§2.9 rule 3):
   * the item is decided, `person_photos.moderationState` becomes `APPROVED`, and a
   * generation that was queued behind the decision is left runnable. The audit row and
   * the consumer's notification are emitted **after** the commit — a consumer told her
   * photograph was approved by a transaction that then rolled back has been lied to.
   */
  async approve(
    admin: ICurrentUser,
    itemId: string,
    dto: ReviewModerationItemDto,
  ): Promise<ModerationItemResponseDto> {
    return this.decide(admin, itemId, dto, ModerationState.APPROVED);
  }

  /**
   * `POST /admin/moderation/:itemId/reject` — keep it blocked.
   *
   * The photograph becomes `BLOCKED`, which is what `PersonPhotosService.resolveGenerationPhoto`
   * already refuses with `PHOTO_BLOCKED_BY_MODERATION`, and any job still waiting on
   * the decision is failed with `MODERATION_REJECTED` rather than left queued forever.
   *
   * ### No email, deliberately
   *
   * §5.17 says "the consumer sees the neutral message", and that message is the §8.3
   * copy behind `PHOTO_BLOCKED_BY_MODERATION` — shown when she next tries to generate,
   * from the error registry, already through the §9.4 check. Nothing is queued to her
   * inbox: writing to a woman to tell her a photograph of herself was rejected, with
   * no reason anyone is willing to state, is worse than letting her find out at the
   * moment she was going to act anyway. The moderator's note stays on the item and in
   * the audit row, which is where an internal note belongs (A-24's principle, one
   * table over).
   */
  async reject(
    admin: ICurrentUser,
    itemId: string,
    dto: ReviewModerationItemDto,
  ): Promise<ModerationItemResponseDto> {
    return this.decide(admin, itemId, dto, ModerationState.REJECTED);
  }

  /* -----------------------------------------------------------------------------------------
   * Queue health — the input to the E-14 backlog alert
   * -------------------------------------------------------------------------------------- */

  /** How many items are waiting, and since when. Two indexed reads, no rows loaded. */
  async pendingSummary(): Promise<{ pending: number; oldestPendingAt: Date | null }> {
    const [pending, oldest] = await Promise.all([
      this.items.count({ where: { state: ModerationState.PENDING } }),
      this.items.findOne({
        where: { state: ModerationState.PENDING },
        order: { createdAt: 'ASC' },
        select: { id: true, createdAt: true },
      }),
    ]);

    return { pending, oldestPendingAt: oldest?.createdAt ?? null };
  }

  /** Items older than `threshold`. The number E-14's copy leads with. */
  async countOverdue(threshold: Date): Promise<number> {
    return this.items
      .createQueryBuilder('item')
      .where('item.state = :state', { state: ModerationState.PENDING })
      .andWhere('item.createdAt < :threshold', { threshold })
      .andWhere('item.deletedAt IS NULL')
      .getCount();
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  private async decide(
    admin: ICurrentUser,
    itemId: string,
    dto: ReviewModerationItemDto,
    decision: ModerationState.APPROVED | ModerationState.REJECTED,
  ): Promise<ModerationItemResponseDto> {
    const item = await this.require(itemId);

    if (item.state !== ModerationState.PENDING) {
      throw new ConflictException(ErrorCode.MODERATION_ALREADY_REVIEWED, {
        details: { itemId, state: item.state, reviewedAt: item.reviewedAt },
      });
    }

    const approved = decision === ModerationState.APPROVED;
    const photoState = approved ? PhotoModerationState.APPROVED : PhotoModerationState.BLOCKED;
    const reviewedAt = new Date();

    const outcome = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<ReviewOutcome> => {
        await manager.getRepository(ModerationItem).update(
          // The `PENDING` predicate is repeated on the write, so two moderators
          // deciding at once cannot both apply their decision (§9.2's ownership rule,
          // one table over).
          { id: item.id, state: ModerationState.PENDING },
          {
            state: decision,
            reviewedBy: admin.id,
            reviewedAt,
            decisionNote: dto.note ?? null,
          },
        );

        const written =
          item.personPhotoId === null
            ? null
            : await this.writePhotoState(manager, item.personPhotoId, photoState);

        const jobSettled = approved ? null : await this.failBlockedJob(manager, item.jobId);

        return { item, photoState: written, jobSettled };
      },
      { label: 'moderation.decide' },
    );

    // After the commit, never inside the work callback (§2.9 rule 3).
    await this.audit.record({
      action: approved
        ? AUDIT_ACTIONS.MODERATION_ITEM_APPROVED
        : AUDIT_ACTIONS.MODERATION_ITEM_REJECTED,
      targetType: AUDIT_TARGET_TYPES.MODERATION_ITEM,
      actorId: admin.id,
      actorRole: admin.role,
      targetId: item.id,
      targetLabel: item.reasonCode,
      metadata: {
        decision,
        source: item.source,
        photoState: outcome.photoState,
        jobSettled: outcome.jobSettled,
        // The note is operator text about an image, not personal data, and A-3 wants
        // the reasoning in the log. `redactObject` still passes over it.
        note: dto.note ?? null,
      },
      requestId: RequestContext.getTraceId() ?? null,
    });

    return this.present(await this.require(itemId), admin);
  }

  /**
   * Writes the decision through to the photograph.
   *
   * `person_photos` belongs to `person-photos` (§4.33), and this is the one column this
   * module writes on it. It is done with a targeted `update` naming the id and the
   * column — never a `save()` of a loaded entity, which would rewrite every column
   * including ones this module deliberately never reads (S-10).
   */
  private async writePhotoState(
    manager: EntityManager,
    personPhotoId: string,
    state: PhotoModerationState,
  ): Promise<PhotoModerationState | null> {
    const result = await manager
      .getRepository(PersonPhoto)
      .update({ id: personPhotoId }, { moderationState: state });

    if ((result.affected ?? 0) === 0) {
      // She deleted the photograph while it sat in the queue (C-38). The item is still
      // decided — the audit trail should show that a human looked at it — but there is
      // nothing left to release or block.
      this.logger.debug('The photograph behind a moderation item no longer exists.');
      return null;
    }
    return state;
  }

  /**
   * Fails a generation that was waiting on this decision.
   *
   * Only `QUEUED` and `RUNNING` jobs: a job that already reached `SUCCEEDED` or
   * `FAILED` has an outcome, and rewriting it would rewrite history that
   * `tryon_results` and `usage_ledger` are already keyed to.
   */
  private async failBlockedJob(
    manager: EntityManager,
    jobId: string | null,
  ): Promise<string | null> {
    if (jobId === null) {
      return null;
    }

    const result = await manager.getRepository(TryOnJob).update(
      { id: jobId, status: In([JobStatus.QUEUED, JobStatus.RUNNING]) },
      {
        status: JobStatus.FAILED,
        errorCode: ErrorCode.MODERATION_REJECTED,
        finishedAt: new Date(),
      },
    );

    return (result.affected ?? 0) > 0 ? jobId : null;
  }

  private async require(itemId: string): Promise<ModerationItem> {
    const item = await this.items.findOne({ where: { id: itemId } });
    if (item === null) {
      throw new NotFoundException(ErrorCode.MODERATION_ITEM_NOT_FOUND, { details: { itemId } });
    }
    return item;
  }

  private async present(
    item: ModerationItem,
    admin: ICurrentUser,
  ): Promise<ModerationItemResponseDto> {
    const facts = await this.photoFactsFor([item]);
    return toModerationItemResponse(
      item,
      item.personPhotoId === null ? null : (facts.get(item.personPhotoId) ?? null),
      admin.id,
      (key, adminId) => this.storage.signedUrl(key, adminId),
    );
  }

  /**
   * The **only** query this module makes against `person_photos`.
   *
   * One read for a whole page rather than one per row, and — the part that matters —
   * an explicit `select` of {@link MODERATION_PHOTO_COLUMNS}. `storageKey` is not in
   * that list, so it is not in the `SELECT`, so it is not in the entity, so it cannot
   * reach a response (S-10).
   */
  private async photoFactsFor(
    items: readonly ModerationItem[],
  ): Promise<Map<string, ModerationPhotoFacts>> {
    const ids = items.map((item) => item.personPhotoId).filter((id): id is string => id !== null);

    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.photos.find({
      where: { id: In(ids) },
      select: MODERATION_PHOTO_COLUMNS,
    });

    return new Map(
      rows.map((row) => [
        row.id,
        { moderationState: row.moderationState, blurredThumbnailKey: row.blurredThumbnailKey },
      ]),
    );
  }
}
