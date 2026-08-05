import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, type SelectQueryBuilder } from 'typeorm';

import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import {
  CatalogHealthCohortDto,
  CatalogHealthResponseDto,
  CatalogHealthThresholdsDto,
} from '../dto/catalog-health.dto';
import { Garment } from '../entities/garment.entity';

import {
  CATALOG_HEALTH_COHORTS,
  ELEVATED_FAILURE_MIN_ATTEMPTS,
  ELEVATED_FAILURE_RATE_PERCENT,
  STALE_TRY_ON_DAYS,
  catalogHealthScopeSql,
  catalogHealthSqlParams,
  staleTryOnCutoff,
  type CatalogHealthContext,
} from './catalog-health.cohorts';
import { GarmentsService } from './garments.service';

import type { CatalogHealthQueryDto } from '../dto/catalog-health.dto';
import type { GarmentResponseDto } from '../dto/garment-response.dto';

/** The query-builder alias every query in this file uses. */
const ALIAS = 'garment';

/** The raw shape `getRawOne()` returns. PostgreSQL sends `COUNT` as a bigint string. */
type CohortCountRow = Record<string, string | number | null>;

/** `bigint` arrives as a string over the wire; `null` on an empty table for some drivers. */
function toCount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * **`GET /admin/catalog-health` — PRD A-15, ARCHITECTURE §5.6.**
 *
 * > "Catalog health panel: garments missing an approved test render, low quality
 * > scores, elevated generation failure rates, and zero try-ons in 30 days."
 *
 * ### The counts are totals, and that is the point
 *
 * Before this route existed the admin console composed the panel from two bounded
 * `GET /admin/garments` sweeps and — honestly — labelled its own numbers a *floor*
 * whenever a sweep hit the page ceiling. A health panel that under-reports is worse
 * than no health panel, because it is the number an admin stops checking.
 *
 * So the counting happens in PostgreSQL: **one** aggregate query, `COUNT(*)` for the
 * scope plus a `COUNT(*) FILTER (WHERE …)` per cohort. No garment row is loaded to be
 * counted, and the answer does not depend on how large the catalogue is.
 *
 * ### The sample is separate, bounded, and ordered worst-first
 *
 * A-15's value is that each row is one click from its remedy, so each cohort also
 * returns a handful of examples — `LIMIT :sample`, never more than
 * `MAX_CATALOG_HEALTH_SAMPLE`, ordered by the column that makes "worst" mean something
 * for that cohort. Four bounded queries; five round trips for the whole panel.
 *
 * ### Where the cohort definitions live
 *
 * `catalog-health.cohorts.ts`, as a SQL fragment beside a pure predicate. This service
 * only assembles them. See that file for why a rule that has to hold in SQL is written
 * down twice and pinned together by a test.
 */
@Injectable()
export class CatalogHealthService {
  constructor(
    @InjectRepository(Garment)
    private readonly garments: Repository<Garment>,
    private readonly settings: SettingsService,
    private readonly presenter: GarmentsService,
  ) {}

  /** `GET /admin/catalog-health` — the whole panel (A-15). */
  async health(query: CatalogHealthQueryDto): Promise<CatalogHealthResponseDto> {
    const now = new Date();
    const context: CatalogHealthContext = {
      minQualityScore: await this.minQualityScore(),
      staleBefore: staleTryOnCutoff(now),
    };

    const counts = await this.counts(context);
    const sampleLimit = query.sample;

    const cohorts: Record<string, CatalogHealthCohortDto> = {};
    for (const cohort of CATALOG_HEALTH_COHORTS) {
      cohorts[cohort.id] = {
        total: toCount(counts[cohort.id]),
        items:
          sampleLimit === 0
            ? []
            : await this.sample(
                cohort.sql(ALIAS),
                cohort.sampleOrderBy,
                cohort.sampleOrder,
                sampleLimit,
                context,
              ),
      };
    }

    const thresholds = new CatalogHealthThresholdsDto();
    thresholds.minQualityScore = context.minQualityScore;
    thresholds.minFailureAttempts = ELEVATED_FAILURE_MIN_ATTEMPTS;
    thresholds.failureRatePercent = ELEVATED_FAILURE_RATE_PERCENT;
    thresholds.staleTryOnDays = STALE_TRY_ON_DAYS;

    const response = new CatalogHealthResponseDto();
    response.generatedAt = now;
    response.inspected = toCount(counts.inspected);
    response.sampleLimit = sampleLimit;
    response.thresholds = thresholds;
    response.missingTestRender = this.cohortOf(cohorts, 'missingTestRender');
    response.lowQualityScore = this.cohortOf(cohorts, 'lowQualityScore');
    response.elevatedFailureRate = this.cohortOf(cohorts, 'elevatedFailureRate');
    response.zeroTryOnsIn30Days = this.cohortOf(cohorts, 'zeroTryOnsIn30Days');
    return response;
  }

  /**
   * The whole panel's arithmetic, in one query.
   *
   * `COUNT(*) FILTER (WHERE …)` rather than four `SELECT COUNT(*)`s: one sequential
   * pass over the scope answers every cohort at once, and — more importantly — every
   * count describes the same instant, so the panel cannot show a garment as fixed in
   * one number and broken in another.
   */
  private async counts(context: CatalogHealthContext): Promise<CohortCountRow> {
    const qb = this.scoped().select('COUNT(*)', 'inspected');

    for (const cohort of CATALOG_HEALTH_COHORTS) {
      qb.addSelect(`COUNT(*) FILTER (WHERE ${cohort.sql(ALIAS)})`, cohort.id);
    }

    qb.setParameters({ ...catalogHealthSqlParams(context) });

    return (await qb.getRawOne<CohortCountRow>()) ?? {};
  }

  /** A bounded worst-first sample of one cohort, presented through the shared mapper. */
  private async sample(
    predicate: string,
    orderBy: string,
    order: 'ASC' | 'DESC',
    limit: number,
    context: CatalogHealthContext,
  ): Promise<GarmentResponseDto[]> {
    const rows = await this.scoped()
      .andWhere(predicate)
      .setParameters({ ...catalogHealthSqlParams(context) })
      // NULLS LAST in both directions: an unset column is not the worst case, it is an
      // absent one — the same rule `GarmentsService.applyOrdering()` applies to A-14.
      .orderBy(`${ALIAS}.${orderBy}`, order, 'NULLS LAST')
      .addOrderBy(`${ALIAS}.id`, 'ASC')
      .limit(limit)
      .getMany();

    // Through `GarmentsService`, so a health row and a catalog-list row are the same
    // DTO built by the same mapper — including `publishable`, which is what tells the
    // console whether the remedy it is linking to has already been applied.
    return this.presenter.presentRows(rows);
  }

  private scoped(): SelectQueryBuilder<Garment> {
    return this.garments.createQueryBuilder(ALIAS).where(catalogHealthScopeSql(ALIAS));
  }

  private cohortOf(
    cohorts: Record<string, CatalogHealthCohortDto>,
    id: string,
  ): CatalogHealthCohortDto {
    return cohorts[id] ?? { total: 0, items: [] };
  }

  private async minQualityScore(): Promise<number> {
    return this.settings.getNumber(SETTINGS_KEYS.QUALITY_MIN_SCORE);
  }
}
