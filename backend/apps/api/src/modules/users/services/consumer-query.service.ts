import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, type SelectQueryBuilder } from 'typeorm';

import {
  buildPaginationMeta,
  currentPeriod,
  paginationSkip,
  Role,
  type IPaginated,
} from '@library/common';
import { paginate } from '@library/database';

import { EnquiryItem } from '@api/modules/enquiries/entities/enquiry-item.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { QuotaLedgerEntry } from '@api/modules/quota/entities/quota-ledger-entry.entity';
import { QuotaReason } from '@api/modules/quota/enums/quota-reason.enum';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';

import {
  ADMIN_RENDER_COLUMNS,
  CONSUMER_PROFILE_COLUMNS,
  CONSUMER_USER_COLUMNS,
} from '../constants/consumer-visibility.constant';
import { ConsumerProfile } from '../entities/consumer-profile.entity';
import { User } from '../entities/user.entity';

import type { ConsumerQueryDto } from '../dto/consumer-query.dto';
import type { ConsumerRenderQueryDto } from '../dto/consumer-render-response.dto';
import type { ConsumerShortlistQueryDto } from '../dto/consumer-shortlist-response.dto';
import type {
  AdminRenderRow,
  AdminShortlistRow,
  ConsumerAggregates,
  ConsumerDetailRow,
  ConsumerEnquiryRow,
  ConsumerListRow,
} from '../interfaces/consumer-rows.interface';

/** Verdicts that put a garment on the shortlist. `NOT_FOR_ME` is analytics only (§4.20). */
const SHORTLISTED_VERDICTS: readonly Verdict[] = [Verdict.LOVE_IT, Verdict.MAYBE];

/** Enquiry history is a summary, not a feed — the full list has its own module. */
const MAX_ENQUIRY_HISTORY = 50;

const EMPTY_AGGREGATES: ConsumerAggregates = {
  generationsThisMonth: 0,
  shortlistSize: 0,
  enquiryCount: 0,
};

/** `SELECT "userId", COUNT(*)` comes back from pg with the count as a string. */
interface CountRow {
  userId: string;
  total: string | number | null;
}

/**
 * **The S-10 boundary.**
 *
 * > "Admins cannot view consumer photos. They see renders only where a consumer has
 * > submitted an enquiry, plus blurred thumbnails in the moderation queue. Enforced
 * > in the query layer and covered by test." — PRD S-10
 *
 * Every admin-facing read of a consumer's data goes through this class, and the
 * enforcement is structural rather than defensive:
 *
 * - **There is no `person_photos` repository in this constructor.** Not filtered
 *   out, not excluded by a mapper — absent. The class holds no handle on the table,
 *   so no query it builds can select a photo column, today or after somebody edits
 *   it in a hurry six months from now.
 * - **Renders are reachable only through `enquiry_items`.** `listEnquiryLinkedRenders`
 *   inner-joins `enquiry_items → enquiries` and scopes both the render and the
 *   enquiry to the same `userId`. §4.24 calls that table "the sole basis on which an
 *   admin may view a render"; this is the only method in the module that reads
 *   `tryon_results`, and it cannot return a render she never attached to an enquiry.
 * - **Every query selects an explicit allow-list** from
 *   `consumer-visibility.constant.ts`. A password hash, a 2FA secret and a recovery
 *   code are never read, so they cannot be serialised.
 *
 * `consumer-query.service.spec.ts` proves all three by recording the fragments the
 * query builder is actually given.
 */
@Injectable()
export class ConsumerQueryService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ConsumerProfile) private readonly profiles: Repository<ConsumerProfile>,
    @InjectRepository(ShortlistItem) private readonly shortlistItems: Repository<ShortlistItem>,
    @InjectRepository(Enquiry) private readonly enquiries: Repository<Enquiry>,
    @InjectRepository(EnquiryItem) private readonly enquiryItems: Repository<EnquiryItem>,
    @InjectRepository(QuotaLedgerEntry) private readonly quotaLedger: Repository<QuotaLedgerEntry>,
    // Deliberately absent: `Repository<PersonPhoto>`. See the class comment (S-10).
  ) {}

  /* -----------------------------------------------------------------------------------------
   * A-16 — the consumer list
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /admin/consumers` — name, email, phone, signup, last active, generations
   * this month, shortlist size, enquiry count, status (A-16).
   *
   * The page is fetched first and the three counts are then derived for **that page's
   * ids only**. Aggregating the whole table to render twenty rows would make the
   * screen slower with every account that signs up.
   */
  async listConsumers(query: ConsumerQueryDto): Promise<IPaginated<ConsumerListRow>> {
    const qb = this.users
      .createQueryBuilder('user')
      .select(qualify('user', CONSUMER_USER_COLUMNS))
      .where('user.role = :role', { role: Role.CONSUMER })
      .andWhere('user.deletedAt IS NULL');

    applyConsumerFilters(qb, query);

    const page = await paginate(qb, query, {
      sortableColumns: ['createdAt', 'lastActiveAt', 'name', 'email', 'status'],
      alias: 'user',
    });

    const aggregates = await this.aggregatesFor(page.items.map((user) => user.id));

    return {
      items: page.items.map((user) => ({
        user,
        aggregates: aggregates.get(user.id) ?? EMPTY_AGGREGATES,
      })),
      meta: page.meta,
    };
  }

  /* -----------------------------------------------------------------------------------------
   * A-17 — consumer detail
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /admin/consumers/:userId` (A-17).
   *
   * Returns `null` when the id is not an active consumer row — including when it is
   * an admin's id, so `/admin/consumers/:adminId` is a 404 rather than a
   * cross-section leak.
   */
  async findConsumerDetail(userId: string): Promise<ConsumerDetailRow | null> {
    const user = await this.findConsumer(userId);
    if (user === null) {
      return null;
    }

    const [profile, enquiries, aggregates] = await Promise.all([
      this.findProfile(userId),
      this.listEnquirySummaries(userId),
      this.aggregatesFor([userId]),
    ]);

    return {
      user,
      profile,
      enquiries,
      aggregates: aggregates.get(userId) ?? EMPTY_AGGREGATES,
    };
  }

  /** The consumer row itself, on the same allow-list. `null` for an admin or a stranger. */
  findConsumer(userId: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .select(qualify('user', CONSUMER_USER_COLUMNS))
      .where('user.id = :userId', { userId })
      .andWhere('user.role = :role', { role: Role.CONSUMER })
      .andWhere('user.deletedAt IS NULL')
      .getOne();
  }

  /** Her C-2 profile row. `null` when she has never been prompted for those fields. */
  findProfile(userId: string): Promise<ConsumerProfile | null> {
    return this.profiles
      .createQueryBuilder('profile')
      .select(qualify('profile', CONSUMER_PROFILE_COLUMNS))
      .where('profile.userId = :userId', { userId })
      .andWhere('profile.deletedAt IS NULL')
      .getOne();
  }

  /** The A-17 enquiry history, newest first. */
  async listEnquirySummaries(userId: string): Promise<ConsumerEnquiryRow[]> {
    const rows = await this.enquiries
      .createQueryBuilder('enquiry')
      .select([
        'enquiry.id',
        'enquiry.reference',
        'enquiry.status',
        'enquiry.createdAt',
        'enquiry.firstRespondedAt',
        'enquiry.closedAt',
        'enquiry.totalValueSnapshot',
      ])
      .where('enquiry.userId = :userId', { userId })
      .andWhere('enquiry.deletedAt IS NULL')
      .orderBy('enquiry.createdAt', 'DESC')
      .take(MAX_ENQUIRY_HISTORY)
      .getMany();

    return rows.map((enquiry) => ({
      id: enquiry.id,
      reference: enquiry.reference,
      status: enquiry.status,
      createdAt: enquiry.createdAt,
      firstRespondedAt: enquiry.firstRespondedAt,
      closedAt: enquiry.closedAt,
      totalValueSnapshot: enquiry.totalValueSnapshot,
    }));
  }

  /* -----------------------------------------------------------------------------------------
   * S-10 — renders, and only through an enquiry
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /admin/consumers/:userId/renders` — "renders appear only where she has
   * submitted an enquiry" (A-17, S-10).
   *
   * The query starts at `enquiry_items` rather than at `tryon_results`, so the
   * enquiry link is not a filter that could be dropped — it is the only way in.
   * Three predicates hold the boundary:
   *
   * 1. `enquiry."userId" = :userId` — the enquiry is hers;
   * 2. `result."userId" = :userId` — the render is hers;
   * 3. `item."resultId" IS NOT NULL` — the item actually carries a render.
   *
   * A render with no `enquiry_items` row is unreachable from here, and there is no
   * other admin route in this module that reads `tryon_results` at all.
   */
  async listEnquiryLinkedRenders(
    userId: string,
    query: ConsumerRenderQueryDto,
  ): Promise<IPaginated<AdminRenderRow>> {
    const qb = this.enquiryItems
      .createQueryBuilder('item')
      .innerJoin(
        Enquiry,
        'enquiry',
        'enquiry.id = item."enquiryId" AND enquiry."userId" = :userId AND enquiry."deletedAt" IS NULL',
      )
      .innerJoin(
        TryOnResult,
        'result',
        'result.id = item."resultId" AND result."userId" = :userId AND result."deletedAt" IS NULL',
      )
      .where('item."resultId" IS NOT NULL')
      .andWhere('item."deletedAt" IS NULL')
      .setParameter('userId', userId);

    const total = await qb.getCount();

    const rows = await qb
      .clone()
      .select('result.id', 'id')
      .addSelect('result."createdAt"', 'createdAt')
      .addSelect('result."storageKey"', 'storageKey')
      .addSelect('result."thumbnailKey"', 'thumbnailKey')
      .addSelect('result."garmentTitleSnapshot"', 'garmentTitleSnapshot')
      .addSelect('result."garmentCategorySnapshot"', 'garmentCategorySnapshot')
      .addSelect('result."garmentPriceSnapshot"', 'garmentPriceSnapshot')
      .addSelect('result."garmentCurrencySnapshot"', 'garmentCurrencySnapshot')
      .addSelect('result.width', 'width')
      .addSelect('result.height', 'height')
      .addSelect('enquiry.id', 'enquiryId')
      .addSelect('enquiry.reference', 'enquiryReference')
      .orderBy('result."createdAt"', query.sortOrder)
      .addOrderBy('result.id', query.sortOrder)
      .offset(paginationSkip(query))
      .limit(query.limit)
      .getRawMany<RawRenderRow>();

    return {
      items: rows.map(toAdminRenderRow),
      meta: buildPaginationMeta(query, total),
    };
  }

  /* -----------------------------------------------------------------------------------------
   * A-17 — her shortlist
   * -------------------------------------------------------------------------------------- */

  /**
   * `GET /admin/consumers/:userId/shortlist` (A-17).
   *
   * Loves and maybes only. `shortlist_items.latestResultId` is **not** followed:
   * that would surface a render she never attached to an enquiry, which S-10
   * forbids, so the join to `tryon_results` simply does not exist here.
   */
  async listShortlist(
    userId: string,
    query: ConsumerShortlistQueryDto,
  ): Promise<IPaginated<AdminShortlistRow>> {
    const qb = this.shortlistItems
      .createQueryBuilder('item')
      .innerJoin(Garment, 'garment', 'garment.id = item."garmentId"')
      .where('item."userId" = :userId', { userId })
      .andWhere('item."deletedAt" IS NULL')
      .andWhere('item.verdict IN (:...verdicts)', { verdicts: SHORTLISTED_VERDICTS });

    const total = await qb.getCount();

    const sortColumn = shortlistSortColumn(query.sortBy);
    const rows = await qb
      .clone()
      .select('item.id', 'id')
      .addSelect('item."garmentId"', 'garmentId')
      .addSelect('item.verdict', 'verdict')
      .addSelect('item.rank', 'rank')
      .addSelect('item.note', 'note')
      .addSelect('item."verdictAt"', 'verdictAt')
      .addSelect('garment.title', 'garmentTitle')
      .addSelect('garment.sku', 'garmentSku')
      .addSelect('garment.price', 'garmentPrice')
      .addSelect('garment.currency', 'garmentCurrency')
      // NULLS LAST so an unranked row cannot displace her actual ordering.
      .orderBy(`item."${sortColumn}"`, query.sortOrder, 'NULLS LAST')
      .addOrderBy('item.id', query.sortOrder)
      .offset(paginationSkip(query))
      .limit(query.limit)
      .getRawMany<RawShortlistRow>();

    return {
      items: rows.map(toAdminShortlistRow),
      meta: buildPaginationMeta(query, total),
    };
  }

  /* -----------------------------------------------------------------------------------------
   * A-16 aggregates — derived, never stored (§4.0 rule 10)
   * -------------------------------------------------------------------------------------- */

  /**
   * The three A-16 counts for a set of accounts.
   *
   * `generationsThisMonth` is summed from `quota_ledger` at read time. There is no
   * `users.generationsUsed` column and there must never be one: the ledger is
   * append-only and the balance is always derived (§4.0 rule 10). Reading it here is
   * a **temporary seam** — once `QuotaModule` lands it owns this arithmetic and this
   * method should call it instead.
   */
  async aggregatesFor(userIds: readonly string[]): Promise<Map<string, ConsumerAggregates>> {
    const result = new Map<string, ConsumerAggregates>();
    if (userIds.length === 0) {
      return result;
    }

    const ids = [...userIds];
    const [generations, shortlistSizes, enquiryCounts] = await Promise.all([
      this.generationsThisMonth(ids),
      this.shortlistSizes(ids),
      this.enquiryCounts(ids),
    ]);

    for (const userId of ids) {
      result.set(userId, {
        generationsThisMonth: generations.get(userId) ?? 0,
        shortlistSize: shortlistSizes.get(userId) ?? 0,
        enquiryCount: enquiryCounts.get(userId) ?? 0,
      });
    }

    return result;
  }

  /** Consumption is stored as a negative delta, so the count is `-SUM(delta)` (§4.26). */
  private async generationsThisMonth(userIds: string[]): Promise<Map<string, number>> {
    const rows = await this.quotaLedger
      .createQueryBuilder('ledger')
      .select('ledger."userId"', 'userId')
      .addSelect('COALESCE(SUM(-ledger.delta), 0)', 'total')
      .where('ledger."userId" IN (:...userIds)', { userIds })
      .andWhere('ledger.period = :period', { period: currentPeriod() })
      .andWhere('ledger.reason = :reason', { reason: QuotaReason.GENERATION_CONSUMED })
      .groupBy('ledger."userId"')
      .getRawMany<CountRow>();

    return toCountMap(rows);
  }

  private async shortlistSizes(userIds: string[]): Promise<Map<string, number>> {
    const rows = await this.shortlistItems
      .createQueryBuilder('item')
      .select('item."userId"', 'userId')
      .addSelect('COUNT(*)', 'total')
      .where('item."userId" IN (:...userIds)', { userIds })
      .andWhere('item."deletedAt" IS NULL')
      .andWhere('item.verdict IN (:...verdicts)', { verdicts: SHORTLISTED_VERDICTS })
      .groupBy('item."userId"')
      .getRawMany<CountRow>();

    return toCountMap(rows);
  }

  private async enquiryCounts(userIds: string[]): Promise<Map<string, number>> {
    const rows = await this.enquiries
      .createQueryBuilder('enquiry')
      .select('enquiry."userId"', 'userId')
      .addSelect('COUNT(*)', 'total')
      .where('enquiry."userId" IN (:...userIds)', { userIds })
      .andWhere('enquiry."deletedAt" IS NULL')
      .groupBy('enquiry."userId"')
      .getRawMany<CountRow>();

    return toCountMap(rows);
  }
}

/* -------------------------------------------------------------------------------------------
 * Local helpers
 * ---------------------------------------------------------------------------------------- */

/** `['id','name']` → `['user.id','user.name']`, the form `select()` expects. */
function qualify(alias: string, columns: readonly string[]): string[] {
  return columns.map((column) => `${alias}.${column}`);
}

/** A-16 filters. `search` covers the three identifying fields the list already shows. */
function applyConsumerFilters(qb: SelectQueryBuilder<User>, query: ConsumerQueryDto): void {
  if (query.status !== undefined) {
    qb.andWhere('user.status = :status', { status: query.status });
  }

  if (query.search !== undefined) {
    qb.andWhere(
      '(user.name ILIKE :search OR user.email ILIKE :search OR user.phone ILIKE :search)',
      { search: `%${query.search}%` },
    );
  }

  if (query.hasEnquiries !== undefined) {
    const existsClause =
      'EXISTS (SELECT 1 FROM enquiries e WHERE e."userId" = user.id AND e."deletedAt" IS NULL)';
    qb.andWhere(query.hasEnquiries ? existsClause : `NOT ${existsClause}`);
  }
}

/** Whitelisted by `ConsumerShortlistQueryDto`; mapped here so nothing is interpolated blind. */
function shortlistSortColumn(sortBy: string): 'rank' | 'verdictAt' | 'createdAt' {
  switch (sortBy) {
    case 'verdictAt':
      return 'verdictAt';
    case 'createdAt':
      return 'createdAt';
    default:
      return 'rank';
  }
}

interface RawRenderRow {
  id: string;
  createdAt: Date | string;
  storageKey: string;
  thumbnailKey: string | null;
  garmentTitleSnapshot: string;
  garmentCategorySnapshot: string;
  garmentPriceSnapshot: string | number | null;
  garmentCurrencySnapshot: string;
  width: string | number;
  height: string | number;
  enquiryId: string;
  enquiryReference: string;
}

function toAdminRenderRow(raw: RawRenderRow): AdminRenderRow {
  return {
    id: raw.id,
    createdAt: toDate(raw.createdAt),
    storageKey: raw.storageKey,
    thumbnailKey: raw.thumbnailKey,
    garmentTitleSnapshot: raw.garmentTitleSnapshot,
    garmentCategorySnapshot: raw.garmentCategorySnapshot,
    garmentPriceSnapshot: toNullableNumber(raw.garmentPriceSnapshot),
    garmentCurrencySnapshot: raw.garmentCurrencySnapshot,
    width: toNumber(raw.width),
    height: toNumber(raw.height),
    enquiryId: raw.enquiryId,
    enquiryReference: raw.enquiryReference,
  };
}

interface RawShortlistRow {
  id: string;
  garmentId: string;
  verdict: string;
  rank: string | number | null;
  note: string | null;
  verdictAt: Date | string;
  garmentTitle: string;
  garmentSku: string;
  garmentPrice: string | number | null;
  garmentCurrency: string;
}

function toAdminShortlistRow(raw: RawShortlistRow): AdminShortlistRow {
  return {
    id: raw.id,
    garmentId: raw.garmentId,
    verdict: raw.verdict,
    rank: toNullableNumber(raw.rank),
    note: raw.note,
    verdictAt: toDate(raw.verdictAt),
    garmentTitle: raw.garmentTitle,
    garmentSku: raw.garmentSku,
    garmentPrice: toNullableNumber(raw.garmentPrice),
    garmentCurrency: raw.garmentCurrency,
  };
}

/** `decimal` and `bigint` come back from pg as strings; `COUNT(*)` always does. */
function toCountMap(rows: readonly CountRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.userId, toNumber(row.total ?? 0));
  }
  return map;
}

function toNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Re-exported so a test can assert the render allow-list without reaching into the constant file. */
export { ADMIN_RENDER_COLUMNS };
