import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { DEFAULT_BILLING_TIME_ZONE } from '@library/common';

import { Category } from '@api/modules/categories/entities/category.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';

import { LEADERBOARD_MIN_TRYONS } from '../constants/analytics.constants';
import {
  ActivityCellDto,
  ActivityResponseDto,
  CategoryPerformanceResponseDto,
  CategoryPerformanceRowDto,
  GarmentLeaderboardResponseDto,
  GarmentLeaderboardRowDto,
  RejectionReasonRowDto,
  RejectionReasonsResponseDto,
} from '../dto/analytics-response.dto';
import { percent } from '../queries/funnel-math';
import {
  buildLeaderboardRow,
  buildRejectionRollup,
  count,
  type GarmentCountsRaw,
} from '../queries/leaderboard-math';

import type { AnalyticsWindow } from '../queries/analytics-window';

/** `LOVE_IT` and `MAYBE` — what A-37 counts as a star (§4.20). */
const STAR_VERDICTS: readonly Verdict[] = [Verdict.LOVE_IT, Verdict.MAYBE];

/**
 * **A-37, A-38 and the A-39 catalogue half.**
 *
 * ### Why the leaderboard counts renders, not jobs
 *
 * `tryon_results` is the table that survives (§4.18): jobs are prunable after ninety
 * days, results are permanent (C-27), and a result carries `garmentTitleSnapshot` so it
 * still reads after the garment is deleted (C-29). A leaderboard built on `tryon_jobs`
 * would quietly lose its own history every quarter.
 *
 * ### Why every query here is an aggregate with a floor and a ceiling
 *
 * §5.18: "every query must be bounded and indexed-friendly; none may load an unbounded
 * result set into memory". A studio with a good year has hundreds of thousands of
 * renders and every one of them is a row this module must never fetch. So each method
 * below is a `GROUP BY` returning at most `limit` rows, with the window in the `WHERE`
 * and — for the leaderboard — a `HAVING` floor that keeps statistical noise out before
 * it is transmitted rather than after.
 *
 * ### Nothing here can identify a consumer
 *
 * Every aggregate groups by garment, category, reason or hour. There is no `userId` in
 * any `SELECT`, no join to `person_photos`, and no column that could carry a storage
 * key. A-16 defines what an admin may know about an individual consumer; these reports
 * are about the catalogue and disclose nothing about anyone (S-10, A-16).
 */
@Injectable()
export class CatalogAnalyticsService {
  constructor(
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    @InjectRepository(ShortlistItem)
    private readonly shortlist: Repository<ShortlistItem>,
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    private readonly config: ConfigService,
  ) {}

  /**
   * `GET /admin/analytics/garments` — A-37.
   *
   * Try-ons come from `tryon_results`; stars, rejects and enquiries are correlated
   * subqueries against the same window. Subqueries rather than joins, because joining
   * `shortlist_items` and `enquiry_items` onto renders multiplies rows against each
   * other and every count then needs a `DISTINCT` to undo it.
   */
  async garmentLeaderboard(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<GarmentLeaderboardResponseDto> {
    const rows = await this.results
      .createQueryBuilder('r')
      .select('r.garmentId', 'garmentId')
      .addSelect('MIN(r."garmentTitleSnapshot")', 'title')
      .addSelect('MIN(r."garmentCategorySnapshot")', 'categoryName')
      .addSelect('COUNT(*)', 'tryOns')
      .addSelect(
        `(SELECT COUNT(*) FROM "shortlist_items" s
            WHERE s."garmentId" = r."garmentId"
              AND s."verdict" IN (:...stars)
              AND s."verdictAt" BETWEEN :from AND :to
              AND s."deletedAt" IS NULL)`,
        'stars',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM "shortlist_items" s
            WHERE s."garmentId" = r."garmentId"
              AND s."verdict" = :rejected
              AND s."verdictAt" BETWEEN :from AND :to
              AND s."deletedAt" IS NULL)`,
        'rejects',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM "enquiry_items" e
            WHERE e."garmentId" = r."garmentId"
              AND e."createdAt" BETWEEN :from AND :to
              AND e."deletedAt" IS NULL)`,
        'enquiries',
      )
      .where('r.garmentId IS NOT NULL')
      .andWhere('r."isTestRender" = false')
      .andWhere('r.createdAt BETWEEN :from AND :to')
      .andWhere('r.deletedAt IS NULL')
      .setParameters({
        from: window.from,
        to: window.to,
        stars: STAR_VERDICTS,
        rejected: Verdict.NOT_FOR_ME,
      })
      .groupBy('r.garmentId')
      .having('COUNT(*) >= :minimum', { minimum: LEADERBOARD_MIN_TRYONS })
      .orderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany<GarmentCountsRaw>();

    const dto = new GarmentLeaderboardResponseDto();
    dto.from = window.from;
    dto.to = window.to;
    dto.minimumTryOns = LEADERBOARD_MIN_TRYONS;
    dto.garments = rows.map((raw) =>
      Object.assign(new GarmentLeaderboardRowDto(), buildLeaderboardRow(raw)),
    );
    return dto;
  }

  /**
   * `GET /admin/analytics/rejection-reasons` — A-38.
   *
   * > "Rejection reasons rollup by neckline, color, weight, silhouette and price."
   *
   * The `NOT_FOR_ME` rows carry them (§4.20: those rows "are retained for A-38
   * rejection-reason analytics"). `rejectReason` is nullable — C-21 lets her decline to
   * say why — and the rollup reports those as `UNSTATED` rather than dropping them; see
   * {@link buildRejectionRollup} for why silently excluding them would overstate every
   * stated reason.
   */
  async rejectionReasons(window: AnalyticsWindow): Promise<RejectionReasonsResponseDto> {
    const rows = await this.shortlist
      .createQueryBuilder('s')
      .select('s.rejectReason', 'reason')
      .addSelect('COUNT(*)', 'count')
      .where('s.verdict = :verdict', { verdict: Verdict.NOT_FOR_ME })
      .andWhere('s."verdictAt" BETWEEN :from AND :to', { from: window.from, to: window.to })
      .andWhere('s.deletedAt IS NULL')
      .groupBy('s.rejectReason')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany<{ reason: string | null; count: string }>();

    const rollup = buildRejectionRollup(rows);

    const dto = new RejectionReasonsResponseDto();
    dto.from = window.from;
    dto.to = window.to;
    dto.totalRejections = rollup.reduce((sum, row) => sum + row.count, 0);
    dto.reasons = rollup.map((row) => Object.assign(new RejectionReasonRowDto(), row));
    return dto;
  }

  /**
   * `GET /admin/analytics/categories` — the A-39 category half.
   *
   * Grouped on `tryon_results.garmentCategorySnapshot` rather than joined to
   * `categories`, for the same reason C-29 exists: the snapshot is what survives a
   * recategorisation or a deletion, and a report that joined the live table would
   * silently reassign last month's renders when a buyer reorganised the catalogue this
   * month.
   *
   * `publishedGarments` is the one figure that *is* about the catalogue as it stands
   * today, so it comes from `categories.publishedGarmentCount` (§4.12) — a maintained
   * counter, not a scan.
   *
   * ### The two subqueries count the same renders, not a superset of them
   *
   * They used to join `shortlist_items` → `garments` → `categories` and match on
   * `c."name" = r."garmentCategorySnapshot"`, which was wrong twice over and in the same
   * direction — upward:
   *
   *  - **no `deletedAt` predicate on `garments` or `categories`.** A verdict against a
   *    soft-deleted garment still counted, while the `tryon_results` denominator excludes
   *    soft-deleted rows. Numerator and denominator did not describe the same population.
   *  - **`categories.name` is not unique.** §4.12 makes the tree unique on
   *    `(parentId, slug)`, so two "Formal" categories under different parents are two
   *    rows, and the join multiplied every verdict by however many of them there were.
   *
   * Between them a `starRate` could exceed 100% — a number that is not merely imprecise
   * but self-evidently impossible, on a screen a buyer uses to decide what to stock.
   *
   * Both are now correlated on the *snapshot*, which is what the denominator groups by:
   * `shortlist_items` and `enquiry_items` reach their garment's category snapshot the same
   * way the renders do, through `tryon_results`. That keeps C-29's "the snapshot is what
   * survives" argument intact — one recategorisation does not retrospectively move last
   * month's verdicts — and it makes the ratio a ratio of like to like.
   */
  async categoryPerformance(
    window: AnalyticsWindow,
    limit: number,
  ): Promise<CategoryPerformanceResponseDto> {
    const rows = await this.results
      .createQueryBuilder('r')
      .select('r."garmentCategorySnapshot"', 'name')
      .addSelect('COUNT(*)', 'tryOns')
      .addSelect(
        `(SELECT COUNT(DISTINCT s."id") FROM "shortlist_items" s
            WHERE s."verdict" IN (:...stars)
              AND s."verdictAt" BETWEEN :from AND :to
              AND s."deletedAt" IS NULL
              AND EXISTS (
                SELECT 1 FROM "tryon_results" sr
                 WHERE sr."garmentId" = s."garmentId"
                   AND sr."garmentCategorySnapshot" = r."garmentCategorySnapshot"
                   AND sr."isTestRender" = false
                   AND sr."deletedAt" IS NULL))`,
        'stars',
      )
      .addSelect(
        `(SELECT COUNT(DISTINCT e."id") FROM "enquiry_items" e
            WHERE e."createdAt" BETWEEN :from AND :to
              AND e."deletedAt" IS NULL
              AND EXISTS (
                SELECT 1 FROM "tryon_results" er
                 WHERE er."garmentId" = e."garmentId"
                   AND er."garmentCategorySnapshot" = r."garmentCategorySnapshot"
                   AND er."isTestRender" = false
                   AND er."deletedAt" IS NULL))`,
        'enquiries',
      )
      .where('r."isTestRender" = false')
      .andWhere('r.createdAt BETWEEN :from AND :to')
      .andWhere('r.deletedAt IS NULL')
      .setParameters({ from: window.from, to: window.to, stars: STAR_VERDICTS })
      .groupBy('r."garmentCategorySnapshot"')
      .orderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany<{ name: string; tryOns: string; stars: string; enquiries: string }>();

    const live = await this.categories.find({
      where: { archived: false },
      select: { id: true, name: true, publishedGarmentCount: true },
      take: limit * 2,
    });
    const byName = new Map(live.map((category) => [category.name, category]));

    const dto = new CategoryPerformanceResponseDto();
    dto.from = window.from;
    dto.to = window.to;
    dto.categories = rows.map((row) => {
      const tryOns = count(row.tryOns);
      const stars = count(row.stars);
      const enquiries = count(row.enquiries);
      const category = byName.get(row.name);

      const item = new CategoryPerformanceRowDto();
      // A snapshot with no live category is a category that has since been deleted —
      // reported under its snapshot name with no id, rather than dropped (C-29).
      item.categoryId = category?.id ?? '';
      item.name = row.name;
      item.publishedGarments = category?.publishedGarmentCount ?? 0;
      item.tryOns = tryOns;
      item.stars = stars;
      item.enquiries = enquiries;
      item.starRate = percent(stars, tryOns);
      item.enquiryRate = percent(enquiries, tryOns);
      return item;
    });
    return dto;
  }

  /**
   * `GET /admin/analytics/activity` — the A-39 "activity by hour and day".
   *
   * ### Local time, not UTC
   *
   * A studio in Karachi wants to know that Thursday evening is busy, and Thursday
   * evening in Karachi is Thursday afternoon in UTC. `EXTRACT` runs against
   * `createdAt AT TIME ZONE :zone`, with the zone from `TIMEZONE` (§7) — the same
   * setting the ledger period boundary uses, so a chart and a bill never disagree about
   * which day it is.
   *
   * ### Sparse, not dense
   *
   * A dense 7×24 grid is 168 cells of which a young platform fills perhaps twenty. Only
   * cells with activity are returned; the screen draws the zeroes, which it has to be
   * able to do anyway for its empty state (D-5).
   */
  async activity(window: AnalyticsWindow): Promise<ActivityResponseDto> {
    const zone = this.config.get<string>('TIMEZONE') ?? DEFAULT_BILLING_TIME_ZONE;

    const rows = await this.jobs
      .createQueryBuilder('j')
      .select(`EXTRACT(DOW FROM j."createdAt" AT TIME ZONE :zone)`, 'dayOfWeek')
      .addSelect(`EXTRACT(HOUR FROM j."createdAt" AT TIME ZONE :zone)`, 'hour')
      .addSelect('COUNT(*)', 'generations')
      .where('j.createdAt BETWEEN :from AND :to')
      .andWhere('j.deletedAt IS NULL')
      .setParameters({ zone, from: window.from, to: window.to })
      .groupBy('1')
      .addGroupBy('2')
      .orderBy('1', 'ASC')
      .addOrderBy('2', 'ASC')
      .getRawMany<{ dayOfWeek: string; hour: string; generations: string }>();

    const cells = rows.map((row) => {
      const cell = new ActivityCellDto();
      cell.dayOfWeek = count(row.dayOfWeek);
      cell.hour = count(row.hour);
      cell.generations = count(row.generations);
      return cell;
    });

    const dto = new ActivityResponseDto();
    dto.from = window.from;
    dto.to = window.to;
    dto.timeZone = zone;
    dto.cells = cells;
    dto.peakHour = peakOf(cells, (cell) => cell.hour);
    dto.peakDayOfWeek = peakOf(cells, (cell) => cell.dayOfWeek);
    return dto;
  }
}

/**
 * The busiest bucket along one axis of the grid.
 *
 * Exported-adjacent and pure so the "no activity at all" case has an obvious answer:
 * zero, which the screen renders as its empty state rather than as midnight on Sunday
 * being unusually popular.
 */
function peakOf(
  cells: readonly ActivityCellDto[],
  axis: (cell: ActivityCellDto) => number,
): number {
  const totals = new Map<number, number>();
  for (const cell of cells) {
    const key = axis(cell);
    totals.set(key, (totals.get(key) ?? 0) + cell.generations);
  }

  let peak = 0;
  let best = -1;
  for (const [key, total] of totals) {
    if (total > best) {
      best = total;
      peak = key;
    }
  }
  return peak;
}
