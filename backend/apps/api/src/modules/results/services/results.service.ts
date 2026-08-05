import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { ILike, In, IsNull, Not, Repository, type FindOptionsWhere } from 'typeorm';

import {
  ErrorCode,
  NotFoundException,
  OwnershipException,
  paginate,
  paginationSkip,
  type ICurrentUser,
  type IPaginated,
} from '@library/common';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import type { ShortlistItemResponseDto } from '@api/modules/shortlist/dto/shortlist-response.dto';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { ShortlistService } from '@api/modules/shortlist/services/shortlist.service';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { NO_VERDICT } from '../dto/result-query.dto';
import { ResultGroupDto, ResultResponseDto } from '../dto/result-response.dto';
import { TryOnResult } from '../entities/tryon-result.entity';
import { toResultResponse, type ResultVerdictProjection } from '../mappers/result.mapper';

import type { ResultQueryDto } from '../dto/result-query.dto';
import type { ResultVerdictDto } from '../dto/result-verdict.dto';

/**
 * A `where` clause, or an array of them — TypeORM reads an array as `OR`. The "no verdict
 * yet" filter needs one, because "no shortlist row" and "no garment at all" are two
 * different rows and both mean undecided.
 */
type ResultWhere = FindOptionsWhere<TryOnResult> | FindOptionsWhere<TryOnResult>[];

/**
 * **Try-on history — ARCHITECTURE §5.12, PRD C-24 … C-31.**
 *
 * ### Ownership is a single predicate
 *
 * `tryon_results.userId`. Every read here filters on it, and the one place a row is
 * fetched by id alone (`load()`) exists so the difference between "no such render" and
 * "somebody else's render" can be logged — the client is told the same thing either
 * way, because `GlobalExceptionFilter` masks `RESULT_NOT_OWNED` to `RESULT_NOT_FOUND`
 * (§2.4, S-9, E-7).
 *
 * ### History never joins the garment for its content
 *
 * §4.18 is emphatic: "the history list renders exclusively from the snapshots". The
 * garment is joined for exactly one bit — is it still available to try on? — and a
 * render whose garment has been hard-deleted simply has `garmentAvailable: false`
 * (C-29). The same holds for the photo (C-28): the id goes null, the label snapshot
 * stays, and grouping still works.
 *
 * ### The verdict is projected, never copied
 *
 * §4.20 allows exactly one verdict row per `(userId, garmentId)`, on `shortlist_items`,
 * and says there is no second verdict column anywhere. So `verdict` and `rejectReason`
 * reach the DTO through a single keyed read per page — never through a column here, and
 * never through the client cross-referencing `GET /shortlist`, which cannot answer it:
 * `NOT_FOR_ME` rows are excluded from that response by design, so a rejected piece read
 * that way is indistinguishable from one she has not decided on.
 *
 * The verdict *write* is `ShortlistService`'s, and stays there. `POST
 * /results/:resultId/verdict` (§5.12) resolves the render to its garment and delegates;
 * it is a second door onto one row, not a second row.
 *
 * ### Deleting is permanent, and the copy says so
 *
 * C-31: the row is soft-deleted so the id can never be reused, and the **files are hard
 * deleted immediately**. The confirmation copy promises the image is gone, and it is.
 */
@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(ShortlistItem)
    private readonly verdicts: Repository<ShortlistItem>,
    private readonly shortlist: ShortlistService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  /** `GET /results` — newest first, thumbnails only (C-24, C-25, §9.1). */
  async list(user: ICurrentUser, query: ResultQueryDto): Promise<IPaginated<ResultResponseDto>> {
    const base: FindOptionsWhere<TryOnResult> = { userId: user.id, isTestRender: false };

    if (query.personPhotoId !== undefined) {
      base.personPhotoId = query.personPhotoId;
    }
    if (query.search !== undefined && query.search.trim().length > 0) {
      base.garmentTitleSnapshot = ILike(`%${query.search.trim()}%`);
    }

    const scoped = await this.applyCategory(base, query.categoryId);
    const where = scoped === null ? null : await this.applyVerdict(scoped, user.id, query.verdict);

    // A filter that no row can satisfy is an empty page, not an unfiltered one. Returning
    // early also keeps an empty `IN ()` out of the SQL.
    if (where === null) {
      return paginate<ResultResponseDto>([], query, 0);
    }

    const [rows, total] = await this.results.findAndCount({
      where,
      order: { createdAt: query.sortOrder },
      skip: paginationSkip(query),
      take: query.limit,
    });

    return paginate(await this.present(rows, user), query, total);
  }

  /**
   * `GET /results/groups/by-photo` — C-30.
   *
   * Grouped in memory over the page rather than in SQL, because the group key is
   * "the photo, or the label it had if the photo is gone" — a coalesce over a nullable
   * FK and a snapshot, which reads far more clearly here than as a `GROUP BY`
   * expression that has to be kept in step with the C-28 nulling rule.
   */
  async groupsByPhoto(user: ICurrentUser, query: ResultQueryDto): Promise<ResultGroupDto[]> {
    const page = await this.list(user, query);

    const groups = new Map<string, ResultGroupDto>();

    for (const item of page.items) {
      const key = item.personPhotoId ?? `label:${item.personPhotoLabel ?? ''}`;
      let group = groups.get(key);

      if (group === undefined) {
        group = new ResultGroupDto();
        group.personPhotoId = item.personPhotoId;
        group.personPhotoLabel = item.personPhotoLabel;
        group.count = 0;
        group.items = [];
        groups.set(key, group);
      }

      group.count += 1;
      group.items.push(item);
    }

    return [...groups.values()];
  }

  /** `GET /results/:resultId` — the full render. **Costs nothing** (C-26). */
  async findOne(user: ICurrentUser, resultId: string): Promise<ResultResponseDto> {
    const result = await this.loadOwned(user.id, resultId);
    const [presented] = await this.present([result], user);

    if (presented === undefined) {
      throw new NotFoundException(ErrorCode.RESULT_NOT_FOUND);
    }
    return presented;
  }

  /** The row itself, ownership-checked. Used by the download path. */
  async loadOwned(userId: string, resultId: string): Promise<TryOnResult> {
    const result = await this.results.findOne({ where: { id: resultId } });

    if (result === null) {
      throw new NotFoundException(ErrorCode.RESULT_NOT_FOUND);
    }
    if (result.userId !== userId) {
      // True code thrown, masked code returned (§2.4). E-7 asserts both halves.
      throw new OwnershipException(ErrorCode.RESULT_NOT_OWNED);
    }
    return result;
  }

  /**
   * `DELETE /results/:resultId` — C-31.
   *
   * Files first would risk a row pointing at nothing if the delete failed halfway;
   * row first would risk an orphaned file. The row wins: an orphaned file is swept by
   * the retention cron, while a row whose image is gone is a broken screen.
   */
  async remove(user: ICurrentUser, resultId: string): Promise<void> {
    const result = await this.loadOwned(user.id, resultId);

    await this.results.softDelete({ id: result.id });

    for (const key of [result.storageKey, result.thumbnailKey]) {
      if (key === null) {
        continue;
      }
      try {
        await this.storage.delete(key);
      } catch (error: unknown) {
        this.logger.warn(
          `A render file outlived its row and is now orphaned; the retention sweep will ` +
            `collect it. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.TRYON_RESULT_DELETED,
        targetType: AUDIT_TARGET_TYPES.TRYON_RESULT,
        actorId: user.id,
        actorRole: user.role,
        targetId: result.id,
        // The garment title, never a storage key or a photo reference (E-12).
        targetLabel: result.garmentTitleSnapshot,
      }),
    );
  }

  /**
   * `POST /results/:resultId/verdict` — §5.12, C-20, C-21.
   *
   * A delegation, deliberately. §4.20 puts the verdict on one `(userId, garmentId)` row
   * that `ShortlistService` owns, so this handler's whole job is to answer "which piece
   * is this render of?" from a row it has already ownership-checked, and hand the write
   * on. Nothing about a verdict is decided here, and no verdict is stored here.
   *
   * The garment is read from the render rather than taken from the body, so a client
   * cannot record a verdict against a piece she never saw. `resultId` travels with it,
   * so the shortlist item shows the render she actually decided from.
   */
  async recordVerdict(
    user: ICurrentUser,
    resultId: string,
    dto: ResultVerdictDto,
  ): Promise<ShortlistItemResponseDto> {
    const result = await this.loadOwned(user.id, resultId);

    // C-29: the garment is gone, so there is nothing left to have a verdict on. The
    // render stays in her history; the decision has nowhere to live.
    if (result.garmentId === null) {
      throw new NotFoundException(ErrorCode.GARMENT_NOT_FOUND);
    }

    return this.shortlist.recordVerdict(user, {
      garmentId: result.garmentId,
      verdict: dto.verdict,
      rejectReason: dto.rejectReason,
      note: dto.note,
      resultId: result.id,
    });
  }

  /** `POST /results/:resultId/marketing-opt-in` — §9.3, explicit and per render. */
  async setMarketingOptIn(
    user: ICurrentUser,
    resultId: string,
    optIn: boolean,
  ): Promise<ResultResponseDto> {
    const result = await this.loadOwned(user.id, resultId);

    await this.results.update({ id: result.id }, { marketingOptInAt: optIn ? new Date() : null });

    return this.findOne(user, resultId);
  }

  /**
   * Narrows the page to one category (C-25).
   *
   * Resolved through `garments`, which is where a category currently lives — the
   * snapshot column holds the category *name* it had at render time, and matching an id
   * against a name would quietly lose every render taken before a rename. A render whose
   * garment has been hard-deleted has no live category and so matches no category
   * filter; it keeps its place in her unfiltered history (C-29).
   *
   * Returns `null` when nothing can match, which the caller turns into an empty page.
   */
  private async applyCategory(
    base: FindOptionsWhere<TryOnResult>,
    categoryId: string | undefined,
  ): Promise<FindOptionsWhere<TryOnResult> | null> {
    if (categoryId === undefined) {
      return base;
    }

    const garments = await this.garments.find({ where: { categoryId }, select: { id: true } });
    if (garments.length === 0) {
      return null;
    }

    return { ...base, garmentId: In(garments.map((garment) => garment.id)) };
  }

  /**
   * Narrows the page to one verdict (C-25), over the **whole archive** rather than over
   * whichever page the client happens to hold.
   *
   * Two steps rather than a join, because the verdict lives in another module's table
   * (§4.20) and a shortlist is human-sized: read the garments carrying that verdict, then
   * select the renders of them. `NONE` is the inverse — every render of a piece she has
   * not decided on, *plus* every render whose garment is gone, because a piece that no
   * longer exists can never have carried a verdict. In SQL those are two predicates
   * (`NOT IN` is unknown for a null), so they are two `OR`-ed clauses here.
   */
  private async applyVerdict(
    base: FindOptionsWhere<TryOnResult>,
    userId: string,
    verdict: ResultQueryDto['verdict'],
  ): Promise<ResultWhere | null> {
    if (verdict === undefined) {
      return base;
    }

    const decided = await this.verdicts.find({
      where: verdict === NO_VERDICT ? { userId } : { userId, verdict },
      select: { garmentId: true },
    });
    const garmentIds = [...new Set(decided.map((item) => item.garmentId))];

    if (verdict !== NO_VERDICT) {
      return garmentIds.length === 0 ? null : { ...base, garmentId: In(garmentIds) };
    }

    return garmentIds.length === 0
      ? base
      : [
          { ...base, garmentId: Not(In(garmentIds)) },
          { ...base, garmentId: IsNull() },
        ];
  }

  /**
   * Signs the URLs and answers the two questions the snapshots cannot: is the garment
   * still there to try on (C-29), and what did she decide about it (§4.20)?
   *
   * Two queries for the whole page rather than two per row — a history screen is twenty
   * rows and forty round trips would be forty round trips.
   */
  private async present(
    rows: readonly TryOnResult[],
    user: ICurrentUser,
  ): Promise<ResultResponseDto[]> {
    const garmentIds = [
      ...new Set(rows.map((row) => row.garmentId).filter((id): id is string => id !== null)),
    ];

    const available = new Set<string>();
    const verdicts = new Map<string, ResultVerdictProjection>();

    if (garmentIds.length > 0) {
      const [garments, items] = await Promise.all([
        this.garments.find({
          where: { id: In(garmentIds), publishState: PublishState.PUBLISHED },
          select: { id: true },
        }),
        // Scoped by `userId` before any other filter (§2.9 rule 6). Soft-deleted rows are
        // excluded by the repository, so a withdrawn verdict reads as no verdict.
        this.verdicts.find({
          where: { userId: user.id, garmentId: In(garmentIds) },
          select: { garmentId: true, verdict: true, rejectReason: true },
        }),
      ]);

      for (const garment of garments) {
        available.add(garment.id);
      }
      for (const item of items) {
        verdicts.set(item.garmentId, {
          verdict: item.verdict,
          rejectReason: item.rejectReason,
        });
      }
    }

    return rows.map((row) =>
      toResultResponse(
        row,
        (key) => this.storage.signedUrl(key, user.id),
        row.garmentId !== null && available.has(row.garmentId),
        row.garmentId === null ? null : (verdicts.get(row.garmentId) ?? null),
      ),
    );
  }
}
