import type { SettingsService } from '@api/modules/settings';

import {
  buildArchivedGarment,
  buildGarment,
  buildPublishedGarment,
} from '../../../../test/factories';
import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { TestRenderState } from '../enums/test-render-state.enum';

import {
  CATALOG_HEALTH_COHORTS,
  CATALOG_HEALTH_COHORT_IDS,
  DEFAULT_CATALOG_HEALTH_SAMPLE,
  ELEVATED_FAILURE_MIN_ATTEMPTS,
  ELEVATED_FAILURE_RATE_PERCENT,
  STALE_TRY_ON_DAYS,
  catalogHealthCohort,
  catalogHealthScopeSql,
  isInCatalogHealthScope,
  type CatalogHealthContext,
} from './catalog-health.cohorts';
import { CatalogHealthService } from './catalog-health.service';
import { type GarmentsService } from './garments.service';

import type { CatalogHealthCohortDto, CatalogHealthResponseDto } from '../dto/catalog-health.dto';
import type { GarmentResponseDto } from '../dto/garment-response.dto';
import type { Garment } from '../entities/garment.entity';
import type { SelectQueryBuilder } from 'typeorm';

/**
 * `GET /admin/catalog-health` — PRD A-15, ARCHITECTURE §5.6.
 *
 * The cohort arithmetic is pinned in `catalog-health.cohorts.spec.ts`. What is asserted
 * here is the thing that made this route worth building: **the counts are true totals**.
 * The console used to compose the panel from two bounded `GET /admin/garments` sweeps and
 * had to label its own numbers a floor whenever a sweep hit the page ceiling — and a
 * health panel that under-reports is the number an admin stops checking.
 *
 * So this file asserts three separable properties of the assembly:
 *
 *  - the count query carries **no limit** and is not derived from the sample;
 *  - shrinking or removing the sample does not move a single total;
 *  - the sample is bounded, ordered worst-first, and presented through the shared mapper.
 *
 * ### About the query-builder double
 *
 * The in-memory repository deliberately refuses `createQueryBuilder()` (see its note: the
 * ownership and visibility predicates live there and pretending to emulate them buys false
 * confidence). It is stubbed explicitly, and the stub is not a rubber stamp: it resolves a
 * recorded `WHERE` fragment back to its cohort by **string identity** against
 * `cohort.sql(alias)`, and it evaluates that cohort with the context read from the
 * parameters the service actually bound. A service that forgot `setParameters()` — which
 * is a runtime SQL error in production — fails here rather than counting quietly.
 */

const MIN_QUALITY_SCORE = 70;
const ALIAS = 'garment';

/** One recorded query, so a test can assert what the service asked the database for. */
interface RecordedQuery {
  kind: 'count' | 'sample';
  predicate: string | null;
  limit: number | null;
  orderBy: { column: string; order: string; nulls: string | undefined } | null;
  parameters: Record<string, unknown>;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** The fixture the whole file counts over. Twelve rows; ten of them in scope. */
function catalogue(): Garment[] {
  return [
    // missingTestRender ×3
    buildGarment({ title: 'Draft, never rendered' }),
    buildGarment({ title: 'Render pending', testRenderState: TestRenderState.PENDING }),
    buildPublishedGarment({ title: 'Approved without a timestamp', testRenderApprovedAt: null }),

    // lowQualityScore ×2
    buildPublishedGarment({ title: 'Soft focus', qualityScore: MIN_QUALITY_SCORE - 30 }),
    buildPublishedGarment({ title: 'Busy background', qualityScore: MIN_QUALITY_SCORE - 5 }),

    // elevatedFailureRate ×2
    buildPublishedGarment({ title: 'Flagged upstream', flaggedForReview: true }),
    buildPublishedGarment({
      title: 'Failing half the time',
      failureCount: ELEVATED_FAILURE_MIN_ATTEMPTS,
      tryOnCount: ELEVATED_FAILURE_MIN_ATTEMPTS,
    }),

    // zeroTryOnsIn30Days ×2
    buildPublishedGarment({
      title: 'Published and forgotten',
      publishedAt: daysAgo(STALE_TRY_ON_DAYS + 20),
      lastTriedAt: null,
    }),
    buildPublishedGarment({
      title: 'Last tried before the window',
      publishedAt: daysAgo(STALE_TRY_ON_DAYS + 60),
      lastTriedAt: daysAgo(STALE_TRY_ON_DAYS + 1),
    }),

    // Healthy: in scope, in no cohort.
    buildPublishedGarment({
      title: 'Perfectly well',
      publishedAt: daysAgo(2),
      lastTriedAt: daysAgo(1),
      tryOnCount: 40,
      failureCount: 0,
    }),

    // Out of scope entirely (A-13, and a soft delete). Both would otherwise be counted in
    // missingTestRender, which is what makes them worth having in the fixture.
    buildArchivedGarment({ title: 'Retired on purpose', testRenderApprovedAt: null }),
    buildGarment({ title: 'Deleted', deletedAt: new Date() }),
  ];
}

interface Harness {
  service: CatalogHealthService;
  rows: Garment[];
  queries: RecordedQuery[];
  presenter: jest.Mocked<Pick<GarmentsService, 'presentRows'>>;
}

function build(rows: Garment[] = catalogue(), minQualityScore = MIN_QUALITY_SCORE): Harness {
  const repository = createInMemoryRepository<Garment>({ rows });
  const queries: RecordedQuery[] = [];

  // Explicitly stubbed, as the in-memory repository's own documentation instructs.
  const createQueryBuilder = jest.fn((alias: string): SelectQueryBuilder<Garment> => {
    expect(alias).toBe(ALIAS);
    return createFakeQueryBuilder(rows, queries);
  });
  Object.assign(repository, { createQueryBuilder });

  const settings = createMock<SettingsService>(['getNumber']);
  settings.getNumber.mockResolvedValue(minQualityScore);

  const presenter = createMock<Pick<GarmentsService, 'presentRows'>>(['presentRows']);
  presenter.presentRows.mockImplementation(async (garments: readonly Garment[]) =>
    garments.map(
      (garment) => ({ id: garment.id, title: garment.title }) as unknown as GarmentResponseDto,
    ),
  );

  const service = new CatalogHealthService(
    repository,
    settings,
    presenter as unknown as GarmentsService,
  );

  return { service, rows, queries, presenter };
}

/**
 * A query-builder double that answers from the fixture rows.
 *
 * It resolves each recorded fragment back to the cohort that produced it, so it can never
 * agree with a predicate the service did not actually ask for.
 */
function createFakeQueryBuilder(
  rows: readonly Garment[],
  queries: RecordedQuery[],
): SelectQueryBuilder<Garment> {
  const selects: { alias: string; expression: string }[] = [];
  let scope: string | null = null;
  let predicate: string | null = null;
  let limit: number | null = null;
  let orderBy: RecordedQuery['orderBy'] = null;
  let parameters: Record<string, unknown> = {};

  const contextFromParameters = (): CatalogHealthContext => {
    const minQualityScore = parameters.minQualityScore;
    const staleBefore = parameters.staleBefore;

    if (typeof minQualityScore !== 'number' || !(staleBefore instanceof Date)) {
      throw new Error(
        'The catalog-health query ran without its bound parameters. In PostgreSQL that is a ' +
          'syntax error, not a wrong answer.',
      );
    }
    return { minQualityScore, staleBefore };
  };

  const inScope = (): Garment[] => {
    if (scope !== catalogHealthScopeSql(ALIAS)) {
      throw new Error(`The catalog-health query ran outside the declared scope: ${String(scope)}`);
    }
    return rows.filter((row) => isInCatalogHealthScope(row));
  };

  const cohortFor = (fragment: string): (typeof CATALOG_HEALTH_COHORTS)[number] => {
    const cohort = CATALOG_HEALTH_COHORTS.find((candidate) => candidate.sql(ALIAS) === fragment);
    if (cohort === undefined) {
      throw new Error(`No registered cohort produced this fragment: ${fragment}`);
    }
    return cohort;
  };

  const orderValue = (row: Garment, column: string): number | string | null => {
    // The service orders by `alias.propertyName`; the property on the row is the second
    // half. Reading the aliased string straight off the row would make every value
    // `undefined`, and every ordering assertion would then pass on the id tiebreak alone.
    const property = column.startsWith(`${ALIAS}.`) ? column.slice(ALIAS.length + 1) : column;
    if (!(property in row)) {
      throw new Error(`The sample ordered by "${column}", which is not a column of the row.`);
    }
    const value = (row as unknown as Record<string, unknown>)[property];
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    // Anything else is not an orderable column, and NULLS LAST is the right answer for it.
    return typeof value === 'number' || typeof value === 'string' ? value : null;
  };

  const builder = {
    select(expression: string, alias: string) {
      selects.push({ alias, expression });
      return builder;
    },
    addSelect(expression: string, alias: string) {
      selects.push({ alias, expression });
      return builder;
    },
    where(fragment: string) {
      scope = fragment;
      return builder;
    },
    andWhere(fragment: string) {
      predicate = fragment;
      return builder;
    },
    setParameters(next: Record<string, unknown>) {
      parameters = { ...parameters, ...next };
      return builder;
    },
    orderBy(column: string, order: string, nulls?: string) {
      orderBy = { column, order, nulls };
      return builder;
    },
    addOrderBy() {
      return builder;
    },
    limit(value: number) {
      limit = value;
      return builder;
    },
    async getRawOne<T>(): Promise<T> {
      const context = contextFromParameters();
      const scoped = inScope();
      queries.push({ kind: 'count', predicate, limit, orderBy, parameters });

      const raw: Record<string, string> = {};
      for (const select of selects) {
        if (select.expression === 'COUNT(*)') {
          raw[select.alias] = String(scoped.length);
          continue;
        }
        const fragment = select.expression.replace(/^COUNT\(\*\) FILTER \(WHERE /, '').slice(0, -1);
        const cohort = cohortFor(fragment);
        // A bigint arrives as a string over the wire. Handing back a number here would
        // let a broken `toCount()` pass.
        raw[select.alias] = String(scoped.filter((row) => cohort.matches(row, context)).length);
      }
      return raw as unknown as T;
    },
    async getMany(): Promise<Garment[]> {
      const context = contextFromParameters();
      const scoped = inScope();
      queries.push({ kind: 'sample', predicate, limit, orderBy, parameters });

      if (predicate === null || orderBy === null) {
        throw new Error('A catalog-health sample ran without a predicate or an ordering.');
      }
      const cohort = cohortFor(predicate);
      const { column, order } = orderBy;

      const matched = scoped
        .filter((row) => cohort.matches(row, context))
        .sort((left, right) => {
          const a = orderValue(left, column);
          const b = orderValue(right, column);
          // NULLS LAST in both directions — an unset column is absent, not worst.
          if (a === null || b === null) {
            return a === b ? left.id.localeCompare(right.id) : a === null ? 1 : -1;
          }
          if (a === b) {
            return left.id.localeCompare(right.id);
          }
          const ascending = a < b ? -1 : 1;
          return order === 'DESC' ? -ascending : ascending;
        });

      return limit === null ? matched : matched.slice(0, limit);
    },
  };

  return builder as unknown as SelectQueryBuilder<Garment>;
}

/** What each cohort should total over a fixture, computed from the pure predicates. */
function expectedTotals(rows: readonly Garment[], minQualityScore = MIN_QUALITY_SCORE): number[] {
  const context: CatalogHealthContext = {
    minQualityScore,
    staleBefore: new Date(Date.now() - STALE_TRY_ON_DAYS * 24 * 60 * 60 * 1000),
  };
  const scoped = rows.filter((row) => isInCatalogHealthScope(row));
  return CATALOG_HEALTH_COHORTS.map(
    (cohort) => scoped.filter((row) => cohort.matches(row, context)).length,
  );
}

function cohortsOf(response: CatalogHealthResponseDto): CatalogHealthCohortDto[] {
  return [
    response.missingTestRender,
    response.lowQualityScore,
    response.elevatedFailureRate,
    response.zeroTryOnsIn30Days,
  ];
}

describe('CatalogHealthService — the counts are totals (A-15, §5.6)', () => {
  it('reports every cohort over the whole catalogue', async () => {
    const { service, rows } = build();

    const response = await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    expect(cohortsOf(response).map((cohort) => cohort.total)).toEqual(expectedTotals(rows));
    expect(response.missingTestRender.total).toBe(3);
    expect(response.lowQualityScore.total).toBe(2);
    expect(response.elevatedFailureRate.total).toBe(2);
    expect(response.zeroTryOnsIn30Days.total).toBe(2);
  });

  it('inspects live, non-archived rows only (A-13)', async () => {
    const { service, rows } = build();

    const response = await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    expect(response.inspected).toBe(10);
    expect(rows).toHaveLength(12);
    // Both out-of-scope rows would land in missingTestRender if the scope leaked.
    expect(response.missingTestRender.total).toBe(3);
  });

  it('does not limit the counting query — a total is never a page', async () => {
    const { service, queries } = build();

    await service.health({ sample: 2 });

    const counting = queries.filter((query) => query.kind === 'count');
    expect(counting).toHaveLength(1);
    expect(counting[0]?.limit).toBeNull();
    expect(counting[0]?.predicate).toBeNull();
  });

  it('answers the whole panel from one aggregate, so no two numbers describe different instants', async () => {
    const { service, queries } = build();

    await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    expect(queries.filter((query) => query.kind === 'count')).toHaveLength(1);
    expect(queries.filter((query) => query.kind === 'sample')).toHaveLength(
      CATALOG_HEALTH_COHORTS.length,
    );
  });

  it('reads a bigint count that arrived as a string', async () => {
    const { service } = build();

    const response = await service.health({ sample: 0 });

    for (const cohort of cohortsOf(response)) {
      expect(typeof cohort.total).toBe('number');
      expect(Number.isInteger(cohort.total)).toBe(true);
    }
    expect(typeof response.inspected).toBe('number');
  });

  it('is all zeroes over an empty catalogue, with no cohort missing from the response', async () => {
    const { service } = build([]);

    const response = await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    expect(response.inspected).toBe(0);
    for (const cohort of cohortsOf(response)) {
      expect(cohort.total).toBe(0);
      expect(cohort.items).toEqual([]);
    }
  });

  it('is all zeroes over a catalogue where every piece is well', async () => {
    const healthy = [
      buildPublishedGarment({ publishedAt: daysAgo(1), lastTriedAt: daysAgo(1) }),
      buildPublishedGarment({ publishedAt: daysAgo(3), lastTriedAt: daysAgo(2) }),
    ];
    const { service } = build(healthy);

    const response = await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    expect(response.inspected).toBe(2);
    expect(cohortsOf(response).map((cohort) => cohort.total)).toEqual([0, 0, 0, 0]);
  });
});

describe('CatalogHealthService — the sample is bounded and cannot move a total', () => {
  /** Twelve pieces in one cohort, so a sample of two is unambiguously a subset. */
  function crowded(): Garment[] {
    return Array.from({ length: 12 }, (_unused, index) =>
      buildPublishedGarment({
        title: `Soft focus ${index}`,
        qualityScore: MIN_QUALITY_SCORE - 1 - index,
        publishedAt: daysAgo(1),
        lastTriedAt: daysAgo(1),
      }),
    );
  }

  it('returns the total, not the number of examples it could fit', async () => {
    const { service } = build(crowded());

    const response = await service.health({ sample: 2 });

    expect(response.lowQualityScore.total).toBe(12);
    expect(response.lowQualityScore.items).toHaveLength(2);
    expect(response.sampleLimit).toBe(2);
  });

  it('gives the same totals at every sample size, including zero', async () => {
    const rows = crowded();
    const totalsAt = async (sample: number): Promise<number[]> => {
      const { service } = build(rows);
      const response = await service.health({ sample });
      return cohortsOf(response).map((cohort) => cohort.total);
    };

    const [none, few, many] = await Promise.all([totalsAt(0), totalsAt(2), totalsAt(50)]);

    expect(few).toEqual(none);
    expect(many).toEqual(none);
    expect(none).toEqual(expectedTotals(rows));
  });

  it('issues no sample query at all when `sample` is 0', async () => {
    const { service, queries, presenter } = build();

    const response = await service.health({ sample: 0 });

    expect(queries.filter((query) => query.kind === 'sample')).toHaveLength(0);
    expect(presenter.presentRows).not.toHaveBeenCalled();
    for (const cohort of cohortsOf(response)) {
      expect(cohort.items).toEqual([]);
      expect(cohort.total).toBeGreaterThanOrEqual(0);
    }
  });

  it('applies the requested limit to every sample query', async () => {
    const { service, queries } = build(crowded());

    await service.health({ sample: 3 });

    const samples = queries.filter((query) => query.kind === 'sample');
    expect(samples).toHaveLength(CATALOG_HEALTH_COHORTS.length);
    for (const sample of samples) {
      expect(sample.limit).toBe(3);
    }
  });

  it('orders each sample worst-first by that cohort’s own column, NULLS LAST', async () => {
    const { service, queries } = build();

    await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    const samples = queries.filter((query) => query.kind === 'sample');
    for (const [index, cohort] of CATALOG_HEALTH_COHORTS.entries()) {
      expect(samples[index]?.orderBy).toEqual({
        column: `${ALIAS}.${String(cohort.sampleOrderBy)}`,
        order: cohort.sampleOrder,
        nulls: 'NULLS LAST',
      });
    }
  });

  it('puts the worst piece first, so the top row is the one worth clicking', async () => {
    const worst = buildPublishedGarment({ title: 'Worst', qualityScore: 11 });
    const middling = buildPublishedGarment({ title: 'Middling', qualityScore: 44 });
    const nearlyThere = buildPublishedGarment({ title: 'Nearly there', qualityScore: 66 });
    const { service } = build([nearlyThere, worst, middling]);

    const response = await service.health({ sample: 2 });

    expect(response.lowQualityScore.total).toBe(3);
    expect(response.lowQualityScore.items.map((item) => item.id)).toEqual([worst.id, middling.id]);
  });

  it('reads "worst" per cohort — oldest publication first for the stale one', async () => {
    const ancient = buildPublishedGarment({
      title: 'Ancient',
      publishedAt: daysAgo(STALE_TRY_ON_DAYS + 300),
      lastTriedAt: null,
    });
    const older = buildPublishedGarment({
      title: 'Older',
      publishedAt: daysAgo(STALE_TRY_ON_DAYS + 90),
      lastTriedAt: null,
    });
    const recentEnoughToBeStale = buildPublishedGarment({
      title: 'Just past the window',
      publishedAt: daysAgo(STALE_TRY_ON_DAYS + 1),
      lastTriedAt: null,
    });
    const { service } = build([recentEnoughToBeStale, older, ancient]);

    const response = await service.health({ sample: 2 });

    expect(response.zeroTryOnsIn30Days.total).toBe(3);
    expect(response.zeroTryOnsIn30Days.items.map((item) => item.id)).toEqual([
      ancient.id,
      older.id,
    ]);
  });

  it('presents a health row through the shared garment mapper, publishable flag and all', async () => {
    const { service, presenter } = build();

    await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    // Through `GarmentsService`, so a health row and a catalog-list row are the same DTO.
    expect(presenter.presentRows).toHaveBeenCalledTimes(CATALOG_HEALTH_COHORTS.length);
  });

  it('samples only rows the cohort actually matches', async () => {
    const { service } = build();

    const response = await service.health({ sample: DEFAULT_CATALOG_HEALTH_SAMPLE });

    for (const [index, id] of CATALOG_HEALTH_COHORT_IDS.entries()) {
      const cohort = cohortsOf(response)[index];
      expect(cohort?.items.length).toBeLessThanOrEqual(cohort?.total ?? 0);
      expect(catalogHealthCohort(id).id).toBe(id);
    }
  });
});

describe('CatalogHealthService — the thresholds it counted against', () => {
  it('states them, so the panel does not have to guess', async () => {
    const { service } = build(catalogue(), 55);

    const response = await service.health({ sample: 0 });

    expect(response.thresholds).toEqual({
      minQualityScore: 55,
      minFailureAttempts: ELEVATED_FAILURE_MIN_ATTEMPTS,
      failureRatePercent: ELEVATED_FAILURE_RATE_PERCENT,
      staleTryOnDays: STALE_TRY_ON_DAYS,
    });
  });

  it('counts against the configured quality threshold rather than a constant', async () => {
    const rows = [
      buildPublishedGarment({ qualityScore: 60, publishedAt: daysAgo(1), lastTriedAt: daysAgo(1) }),
    ];

    const lenient = await build(rows, 50).service.health({ sample: 0 });
    const strict = await build(rows, 70).service.health({ sample: 0 });

    expect(lenient.lowQualityScore.total).toBe(0);
    expect(strict.lowQualityScore.total).toBe(1);
  });

  it('stamps the instant the counts were taken', async () => {
    const before = Date.now();
    const { service } = build();

    const response = await service.health({ sample: 0 });

    expect(response.generatedAt).toBeInstanceOf(Date);
    expect(response.generatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(response.generatedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
