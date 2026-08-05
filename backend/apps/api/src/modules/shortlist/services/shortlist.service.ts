import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, Repository, type EntityManager } from 'typeorm';

import {
  ErrorCode,
  NotFoundException,
  OwnershipException,
  ValidationException,
  type ICurrentUser,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { StorageService } from '@library/storage';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ConsumerProfile } from '@api/modules/users/entities/consumer-profile.entity';
import type { BudgetBand } from '@api/modules/users/enums/budget-band.enum';

import { FIRST_SHORTLIST_RANK } from '../constants/shortlist.constants';
import { ShortlistItem } from '../entities/shortlist-item.entity';
import { Verdict } from '../enums/verdict.enum';
import {
  toShortlistItemResponse,
  toShortlistResponse,
  type ShortlistItemContext,
} from '../mappers/shortlist.mapper';
import {
  onlyShortlisted,
  rankForVerdict,
  rejectReasonForVerdict,
  shortlistWhere,
} from '../queries/shortlist.scope';

import type { RecordVerdictDto } from '../dto/record-verdict.dto';
import type { ReorderShortlistDto } from '../dto/reorder-shortlist.dto';
import type { ShortlistItemResponseDto, ShortlistResponseDto } from '../dto/shortlist-response.dto';
import type { UpdateShortlistItemDto } from '../dto/update-shortlist-item.dto';

/**
 * **The shortlist — ARCHITECTURE §5.13, §4.20; PRD C-20, C-21, C-32, A-38.**
 *
 * ### One row per `(userId, garmentId)`, and it is the verdict
 *
 * §4.20 pins this because it is otherwise ambiguous: a verdict from the result view
 * upserts one row, changing a verdict updates that same row, and there is no second
 * verdict column anywhere. `NOT_FOR_ME` rows are kept — A-38 rolls them up by reason —
 * but they carry `rank = null`, never appear on the shortlist, never count toward the
 * budget total and are excluded from enquiries. That last property is enforced in
 * `queries/shortlist.scope.ts`, which `share` and `enquiries` both import rather than
 * restating the predicate.
 *
 * ### Server state, not local state
 *
 * C-32: "Persists across devices." Everything here is a database write. Nothing about
 * the order, the notes or the running total lives in a client, which is also why the
 * reorder takes the whole set: two devices reordering concurrently must produce one of
 * the two intended orders, never an interleaving.
 *
 * ### Ownership on every operation
 *
 * Every read is scoped by `userId` before any other filter (§2.9 rule 6), and every
 * mutation re-reads the row and compares `userId` (§9.2). A shortlist item belonging
 * to somebody else raises `SHORTLIST_ITEM_NOT_OWNED`, which `GlobalExceptionFilter`
 * masks to `SHORTLIST_ITEM_NOT_FOUND` before it reaches the client (§2.4, S-9): the
 * true code is logged, the caller learns nothing.
 *
 * ### Ranks are contiguous, always
 *
 * Every write that can change membership renumbers the surviving rows `1…n` inside the
 * same transaction. A gap is harmless; a *duplicate* is a list that reorders itself
 * between two page loads, and a rank of `null` on a shortlisted row is an item that
 * silently sorts last for one consumer and first for another.
 */
@Injectable()
export class ShortlistService {
  constructor(
    @InjectRepository(ShortlistItem)
    private readonly items: Repository<ShortlistItem>,
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    @InjectRepository(ConsumerProfile)
    private readonly profiles: Repository<ConsumerProfile>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Reads
   * -------------------------------------------------------------------------------------- */

  /** `GET /shortlist` — Love it + Maybe in rank order, with the running total (C-32). */
  async list(user: ICurrentUser): Promise<ShortlistResponseDto> {
    const rows = await this.rankedItems(user.id);
    const [items, budgetBand] = await Promise.all([
      this.present(rows, user.id),
      this.budgetBandOf(user.id),
    ]);

    return toShortlistResponse(items, budgetBand);
  }

  /**
   * Her shortlist in rank order — the rows themselves.
   *
   * Exported through the module so `share` can project it and `enquiries` can snapshot
   * it. Both go through this method rather than querying `shortlist_items` themselves,
   * so "what is on the shortlist" has one definition (§4.20) and a rejection can never
   * reach a share page or an enquiry.
   */
  async rankedItems(userId: string): Promise<ShortlistItem[]> {
    const rows = await this.items.find({
      where: shortlistWhere(userId),
      order: { rank: 'ASC', createdAt: 'ASC' },
    });
    return onlyShortlisted(rows);
  }

  /* -----------------------------------------------------------------------------------------
   * Writes
   * -------------------------------------------------------------------------------------- */

  /**
   * `POST /shortlist` — record a verdict (C-20, C-21).
   *
   * An upsert, not an insert: posting `MAYBE` for a piece already marked `LOVE_IT`
   * moves the existing row, and a second `LOVE_IT` is a no-op that keeps her existing
   * rank rather than jumping the piece to the bottom of her list.
   */
  async recordVerdict(
    user: ICurrentUser,
    dto: RecordVerdictDto,
  ): Promise<ShortlistItemResponseDto> {
    const verdict = dto.verdict ?? Verdict.LOVE_IT;

    const garment = await this.garments.findOne({ where: { id: dto.garmentId } });
    if (garment === null) {
      throw new NotFoundException(ErrorCode.GARMENT_NOT_FOUND);
    }

    const latestResultId = await this.resolveOwnedResultId(user.id, dto.resultId);

    const saved = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<ShortlistItem> => {
        const repository = manager.getRepository(ShortlistItem);
        const existing = await repository.findOne({
          where: { userId: user.id, garmentId: dto.garmentId },
        });

        const row = existing ?? repository.create({ userId: user.id, garmentId: dto.garmentId });

        // An existing rank survives a LOVE_IT ⇄ MAYBE move: both are on the shortlist,
        // and re-tapping a verdict is not a request to reorder her list.
        const keptRank = existing?.rank ?? null;
        const nextRank = keptRank ?? (await this.nextRank(repository, user.id));

        row.verdict = verdict;
        row.rank = rankForVerdict(verdict, nextRank);
        row.rejectReason = rejectReasonForVerdict(verdict, dto.rejectReason ?? null);
        row.note = dto.note ?? existing?.note ?? null;
        row.latestResultId = latestResultId ?? existing?.latestResultId ?? null;
        row.verdictAt = new Date();

        const written = await repository.save(row);
        await this.renumber(repository, user.id);
        return written;
      },
      { label: 'shortlist.recordVerdict' },
    );

    return this.presentOne(saved.id, user);
  }

  /** `PATCH /shortlist/:itemId` — update the note or the verdict (§5.13). */
  async update(
    user: ICurrentUser,
    itemId: string,
    dto: UpdateShortlistItemDto,
  ): Promise<ShortlistItemResponseDto> {
    const item = await this.loadOwned(user.id, itemId);

    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        const repository = manager.getRepository(ShortlistItem);
        const row = await repository.findOne({ where: { id: item.id, userId: user.id } });
        if (row === null) {
          throw new NotFoundException(ErrorCode.SHORTLIST_ITEM_NOT_FOUND);
        }

        if (dto.verdict !== undefined && dto.verdict !== row.verdict) {
          const nextRank = row.rank ?? (await this.nextRank(repository, user.id));
          row.verdict = dto.verdict;
          row.rank = rankForVerdict(dto.verdict, nextRank);
          row.verdictAt = new Date();
        }

        if (dto.rejectReason !== undefined) {
          row.rejectReason = dto.rejectReason;
        }
        // A reason without a rejection would corrupt the A-38 rollup, so it is
        // re-derived from the verdict on the way out whatever the payload said.
        row.rejectReason = rejectReasonForVerdict(row.verdict, row.rejectReason);

        if (dto.note !== undefined) {
          row.note = dto.note;
        }

        await repository.save(row);
        await this.renumber(repository, user.id);
      },
      { label: 'shortlist.update' },
    );

    return this.presentOne(item.id, user);
  }

  /**
   * `POST /shortlist/reorder` — persist a drag-to-rank order (C-32).
   *
   * Atomic across every affected row: the whole set is renumbered inside one
   * `runInTransaction`, so a failure halfway through leaves the previous order intact
   * rather than a half-renumbered list with duplicate ranks.
   *
   * The payload must name **every** shortlisted item. A partial set is refused rather
   * than merged, because merging is where two rows end up sharing a rank.
   */
  async reorder(user: ICurrentUser, dto: ReorderShortlistDto): Promise<ShortlistResponseDto> {
    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        const repository = manager.getRepository(ShortlistItem);
        const shortlisted = onlyShortlisted(
          await repository.find({ where: shortlistWhere(user.id) }),
        );

        this.assertCompleteShortlist(shortlisted, dto.itemIds);

        const byId = new Map(shortlisted.map((row) => [row.id, row]));
        const ordered: ShortlistItem[] = [];

        for (const [index, itemId] of dto.itemIds.entries()) {
          const row = byId.get(itemId);
          if (row === undefined) {
            // Unreachable: assertCompleteShortlist has already proved set equality.
            throw new NotFoundException(ErrorCode.SHORTLIST_ITEM_NOT_FOUND);
          }
          row.rank = FIRST_SHORTLIST_RANK + index;
          ordered.push(row);
        }

        await repository.save(ordered);
      },
      { label: 'shortlist.reorder' },
    );

    return this.list(user);
  }

  /**
   * `DELETE /shortlist/:itemId` — remove a piece from the shortlist (§5.13).
   *
   * Soft-deleted, so the id can never be reused, and the survivors are renumbered in
   * the same transaction. Removing a piece is not the same act as rejecting one: a
   * removal leaves no `NOT_FOR_ME` row, so it contributes nothing to the A-38 rollup,
   * which is correct — she took it off the list, she did not say why.
   */
  async remove(user: ICurrentUser, itemId: string): Promise<void> {
    const item = await this.loadOwned(user.id, itemId);

    await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<void> => {
        const repository = manager.getRepository(ShortlistItem);
        await repository.softDelete({ id: item.id, userId: user.id });
        await this.renumber(repository, user.id);
      },
      { label: 'shortlist.remove' },
    );
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * One row, ownership-checked.
   *
   * The row is fetched by id alone so the difference between "no such item" and
   * "somebody else's item" can be logged. The client is told the same thing either
   * way, because `SHORTLIST_ITEM_NOT_OWNED` is masked to `SHORTLIST_ITEM_NOT_FOUND`
   * (§2.4, S-9, E-7).
   */
  private async loadOwned(userId: string, itemId: string): Promise<ShortlistItem> {
    const item = await this.items.findOne({ where: { id: itemId } });

    if (item === null) {
      throw new NotFoundException(ErrorCode.SHORTLIST_ITEM_NOT_FOUND);
    }
    if (item.userId !== userId) {
      throw new OwnershipException(ErrorCode.SHORTLIST_ITEM_NOT_OWNED);
    }
    return item;
  }

  /**
   * The render she chose to attach, but only if it is hers.
   *
   * A render belonging to another account is dropped silently rather than refused: the
   * id is unguessable, refusing would confirm it exists, and the worst outcome of
   * dropping it is a shortlist row with no thumbnail (§9.2, S-9).
   */
  private async resolveOwnedResultId(
    userId: string,
    resultId: string | undefined,
  ): Promise<string | null> {
    if (resultId === undefined) {
      return null;
    }
    const result = await this.results.findOne({ where: { id: resultId, userId } });
    return result?.id ?? null;
  }

  /** The rank a newly shortlisted piece takes: the bottom of the list. */
  private async nextRank(repository: Repository<ShortlistItem>, userId: string): Promise<number> {
    const rows = onlyShortlisted(await repository.find({ where: shortlistWhere(userId) }));
    const highest = rows.reduce((max, row) => Math.max(max, row.rank ?? 0), 0);
    return highest + 1;
  }

  /**
   * Renumbers the surviving shortlist `1…n`, preserving the existing order.
   *
   * Called from inside every transaction that can change membership. Rows with no rank
   * yet sort last, then by age, so a piece that has just arrived lands at the bottom
   * rather than in an arbitrary position.
   */
  private async renumber(repository: Repository<ShortlistItem>, userId: string): Promise<void> {
    const rows = onlyShortlisted(await repository.find({ where: shortlistWhere(userId) }));

    const ordered = [...rows].sort((left, right) => {
      const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.createdAt.getTime() - right.createdAt.getTime();
    });

    const changed: ShortlistItem[] = [];
    ordered.forEach((row, index) => {
      const rank = FIRST_SHORTLIST_RANK + index;
      if (row.rank !== rank) {
        row.rank = rank;
        changed.push(row);
      }
    });

    if (changed.length > 0) {
      await repository.save(changed);
    }
  }

  /** A reorder must name every shortlisted item exactly once — no more, no fewer. */
  private assertCompleteShortlist(
    shortlisted: readonly ShortlistItem[],
    itemIds: readonly string[],
  ): void {
    const known = new Set(shortlisted.map((row) => row.id));
    const given = new Set(itemIds);

    const missing = [...known].filter((id) => !given.has(id));
    const unknown = [...given].filter((id) => !known.has(id));

    if (missing.length > 0 || unknown.length > 0) {
      throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
        message: 'Send the whole shortlist in the order you want it.',
        errors: [
          {
            field: 'itemIds',
            message: 'The list must name every piece on your shortlist exactly once.',
            code: 'INCOMPLETE_SET',
          },
        ],
        // Counts only. The ids of rows the caller does not already hold would be a
        // disclosure, and the ids they do hold tell them nothing new.
        details: { expected: known.size, received: given.size },
      });
    }
  }

  /** The stated budget band, from her profile (C-32). */
  private async budgetBandOf(userId: string): Promise<BudgetBand | null> {
    const profile = await this.profiles.findOne({ where: { userId } });
    return profile?.budgetBand ?? null;
  }

  /** One item, re-read and presented. Used by the two write paths that return a row. */
  private async presentOne(itemId: string, user: ICurrentUser): Promise<ShortlistItemResponseDto> {
    const row = await this.loadOwned(user.id, itemId);
    const [presented] = await this.present([row], user.id);

    if (presented === undefined) {
      throw new NotFoundException(ErrorCode.SHORTLIST_ITEM_NOT_FOUND);
    }
    return presented;
  }

  /**
   * Rows → DTOs, in two extra queries rather than two per row.
   *
   * The render lookup is scoped by `userId` as well as by id: `latestResultId` is a
   * column on her own row, but scoping the read is what makes a stale or tampered
   * value incapable of pulling somebody else's render into her list.
   */
  private async present(
    rows: readonly ShortlistItem[],
    userId: string,
  ): Promise<ShortlistItemResponseDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const garmentIds = [...new Set(rows.map((row) => row.garmentId))];
    const resultIds = [
      ...new Set(rows.map((row) => row.latestResultId).filter((id): id is string => id !== null)),
    ];

    const [garments, results] = await Promise.all([
      this.garments.find({ where: { id: In(garmentIds) } }),
      resultIds.length === 0
        ? Promise.resolve<TryOnResult[]>([])
        : this.results.find({ where: { id: In(resultIds), userId } }),
    ]);

    const garmentById = new Map(garments.map((garment) => [garment.id, garment]));
    const resultById = new Map(results.map((result) => [result.id, result]));

    return rows.map((row) => {
      const context: ShortlistItemContext = {
        garment: garmentById.get(row.garmentId),
        result: row.latestResultId === null ? undefined : resultById.get(row.latestResultId),
        sign: (key: string) => this.storage.signedUrl(key, userId),
      };
      return toShortlistItemResponse(row, context);
    });
  }
}
