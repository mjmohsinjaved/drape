import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { ILike, In, Repository, type FindOptionsWhere } from 'typeorm';

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
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { ResultGroupDto, ResultResponseDto } from '../dto/result-response.dto';
import { TryOnResult } from '../entities/tryon-result.entity';
import { toResultResponse } from '../mappers/result.mapper';

import type { ResultQueryDto } from '../dto/result-query.dto';

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
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  /** `GET /results` — newest first, thumbnails only (C-24, C-25, §9.1). */
  async list(user: ICurrentUser, query: ResultQueryDto): Promise<IPaginated<ResultResponseDto>> {
    const where: FindOptionsWhere<TryOnResult> = { userId: user.id, isTestRender: false };

    if (query.personPhotoId !== undefined) {
      where.personPhotoId = query.personPhotoId;
    }
    if (query.search !== undefined && query.search.trim().length > 0) {
      where.garmentTitleSnapshot = ILike(`%${query.search.trim()}%`);
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
   * Signs the URLs and answers the one question the snapshots cannot: is the garment
   * still there to try on? (C-29.)
   *
   * One query for the whole page rather than one per row — a history screen is twenty
   * rows and twenty round trips would be twenty round trips.
   */
  private async present(
    rows: readonly TryOnResult[],
    user: ICurrentUser,
  ): Promise<ResultResponseDto[]> {
    const garmentIds = [
      ...new Set(rows.map((row) => row.garmentId).filter((id): id is string => id !== null)),
    ];

    const available = new Set<string>();
    if (garmentIds.length > 0) {
      const garments = await this.garments.find({
        where: { id: In(garmentIds), publishState: PublishState.PUBLISHED },
        select: { id: true },
      });
      for (const garment of garments) {
        available.add(garment.id);
      }
    }

    return rows.map((row) =>
      toResultResponse(
        row,
        (key) => this.storage.signedUrl(key, user.id),
        row.garmentId !== null && available.has(row.garmentId),
      ),
    );
  }
}
