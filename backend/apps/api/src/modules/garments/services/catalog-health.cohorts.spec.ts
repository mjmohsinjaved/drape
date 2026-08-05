import {
  buildArchivedGarment,
  buildGarment,
  buildPublishedGarment,
} from '../../../../test/factories';
import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

import {
  CATALOG_HEALTH_COHORTS,
  CATALOG_HEALTH_COHORT_IDS,
  ELEVATED_FAILURE_MIN_ATTEMPTS,
  ELEVATED_FAILURE_RATE_PERCENT,
  STALE_TRY_ON_DAYS,
  catalogHealthCohort,
  catalogHealthScopeSql,
  catalogHealthSqlParams,
  isInCatalogHealthScope,
  staleTryOnCutoff,
  type CatalogHealthContext,
} from './catalog-health.cohorts';

import type { Garment } from '../entities/garment.entity';

/**
 * The four A-15 cohorts — PRD A-15, ARCHITECTURE §5.6.
 *
 * Each cohort is declared twice: a SQL fragment the aggregate query counts with, and a
 * pure `matches()` predicate. There is no PostgreSQL on this machine (CLAUDE.md), so the
 * SQL half cannot be executed — which is exactly why this file exists. It does two jobs:
 *
 *  1. **the arithmetic**, run through `matches()` over a fixed fixture set, boundary by
 *     boundary, including the empty case for every cohort;
 *  2. **the pin**, asserting the two halves name the same columns and the same
 *     thresholds — so a change made to one and not the other fails here rather than
 *     silently making the panel disagree with itself.
 */

const NOW = new Date('2026-08-05T12:00:00.000Z');
const MIN_QUALITY_SCORE = 70;

const CONTEXT: CatalogHealthContext = {
  minQualityScore: MIN_QUALITY_SCORE,
  staleBefore: staleTryOnCutoff(NOW),
};

/** `days` before `NOW`, as a Date. Keeps the window arithmetic out of the test bodies. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

/** How many of `rows` a cohort claims. The whole set, never a page. */
function countIn(id: (typeof CATALOG_HEALTH_COHORT_IDS)[number], rows: readonly Garment[]): number {
  const cohort = catalogHealthCohort(id);
  return rows.filter((row) => cohort.matches(row, CONTEXT)).length;
}

function idsIn(id: (typeof CATALOG_HEALTH_COHORT_IDS)[number], rows: readonly Garment[]): string[] {
  const cohort = catalogHealthCohort(id);
  return rows.filter((row) => cohort.matches(row, CONTEXT)).map((row) => row.id);
}

describe('catalog-health cohorts — the scope every count is taken inside', () => {
  it('excludes soft-deleted and archived rows, and keeps drafts', () => {
    const draft = buildGarment();
    const published = buildPublishedGarment();
    const archived = buildArchivedGarment();
    const deleted = buildPublishedGarment({ deletedAt: NOW });

    expect(isInCatalogHealthScope(draft)).toBe(true);
    expect(isInCatalogHealthScope(published)).toBe(true);
    // A-13: retired on purpose. Listing it every day is how an admin learns to ignore
    // the panel, which is the one failure mode a health panel cannot survive.
    expect(isInCatalogHealthScope(archived)).toBe(false);
    expect(isInCatalogHealthScope(deleted)).toBe(false);
  });

  it('says the same thing in SQL as it does in TypeScript', () => {
    const sql = catalogHealthScopeSql('garment');

    expect(sql).toContain('garment.deletedAt IS NULL');
    expect(sql).toContain('garment.publishState');
    expect(sql).toContain(PublishState.ARCHIVED);
  });
});

describe('missingTestRender — A-11 / E-10, no approved test render', () => {
  const withRender = buildPublishedGarment();
  const noRenderAtAll = buildGarment();
  const pending = buildGarment({ testRenderState: TestRenderState.PENDING });
  const rejected = buildGarment({ testRenderState: TestRenderState.REJECTED });
  // A half-applied migration or a hand-edited row: the state says approved, the
  // timestamp says it never was. Both columns are checked precisely so this is caught.
  const approvedWithoutTimestamp = buildPublishedGarment({ testRenderApprovedAt: null });

  const rows = [withRender, noRenderAtAll, pending, rejected, approvedWithoutTimestamp];

  it('counts every garment that cannot be published for want of a render', () => {
    expect(countIn('missingTestRender', rows)).toBe(4);
    expect(idsIn('missingTestRender', rows)).toEqual([
      noRenderAtAll.id,
      pending.id,
      rejected.id,
      approvedWithoutTimestamp.id,
    ]);
  });

  it('is zero when every piece carries an approved render', () => {
    expect(countIn('missingTestRender', [withRender, buildPublishedGarment()])).toBe(0);
  });

  it('is zero over an empty catalogue', () => {
    expect(countIn('missingTestRender', [])).toBe(0);
  });

  it('names both columns in SQL, exactly as the predicate reads them', () => {
    const sql = catalogHealthCohort('missingTestRender').sql('garment');

    expect(sql).toContain('garment.testRenderState');
    expect(sql).toContain('garment.testRenderApprovedAt IS NULL');
    expect(sql).toContain(TestRenderState.APPROVED);
  });
});

describe('lowQualityScore — A-10, a recorded score below the pass mark', () => {
  const below = buildPublishedGarment({ qualityScore: MIN_QUALITY_SCORE - 15 });
  const atThreshold = buildPublishedGarment({ qualityScore: MIN_QUALITY_SCORE });
  const above = buildPublishedGarment({ qualityScore: MIN_QUALITY_SCORE + 18 });
  const unscored = buildGarment({ qualityScore: null });
  const overridden = buildPublishedGarment({
    qualityScore: MIN_QUALITY_SCORE - 15,
    qualityOverriddenBy: '99999999-9999-4999-8999-999999999999',
    qualityOverriddenAt: NOW,
  });
  // Half an override is not an override: an admin's decision has to be on the record
  // with both who and when, or the piece is still an open question.
  const halfOverridden = buildPublishedGarment({
    qualityScore: MIN_QUALITY_SCORE - 15,
    qualityOverriddenBy: '99999999-9999-4999-8999-999999999999',
    qualityOverriddenAt: null,
  });

  const rows = [below, atThreshold, above, unscored, overridden, halfOverridden];

  it('counts scored pieces under the threshold whose score nobody has accepted', () => {
    expect(idsIn('lowQualityScore', rows)).toEqual([below.id, halfOverridden.id]);
  });

  it('leaves an unscored piece out — that is the missing-render cohort, not this one', () => {
    expect(countIn('lowQualityScore', [unscored])).toBe(0);
  });

  it('treats the threshold itself as a pass', () => {
    expect(countIn('lowQualityScore', [atThreshold])).toBe(0);
  });

  it('drops a piece whose score an admin has already accepted on the record (A-10)', () => {
    expect(countIn('lowQualityScore', [overridden])).toBe(0);
  });

  it('follows the configured threshold rather than a hard-coded one', () => {
    const strict: CatalogHealthContext = { ...CONTEXT, minQualityScore: MIN_QUALITY_SCORE + 20 };
    const cohort = catalogHealthCohort('lowQualityScore');

    expect(cohort.matches(above, CONTEXT)).toBe(false);
    expect(cohort.matches(above, strict)).toBe(true);
  });

  it('is zero over an empty catalogue', () => {
    expect(countIn('lowQualityScore', [])).toBe(0);
  });

  it('binds the threshold as a parameter rather than inlining it', () => {
    const sql = catalogHealthCohort('lowQualityScore').sql('garment');

    expect(sql).toContain('garment.qualityScore IS NOT NULL');
    expect(sql).toContain('garment.qualityScore < :minQualityScore');
    expect(sql).toContain('garment.qualityOverriddenBy IS NULL');
    expect(sql).toContain('garment.qualityOverriddenAt IS NULL');
    expect(catalogHealthSqlParams(CONTEXT).minQualityScore).toBe(MIN_QUALITY_SCORE);
  });
});

describe('elevatedFailureRate — A-15 / §8.3, repeated upstream failures', () => {
  const flagged = buildPublishedGarment({ flaggedForReview: true, tryOnCount: 0, failureCount: 0 });
  // Exactly at both boundaries, derived from the constants so the fixture moves with them.
  const atBoundary = buildPublishedGarment({
    failureCount: ELEVATED_FAILURE_MIN_ATTEMPTS / 4,
    tryOnCount: ELEVATED_FAILURE_MIN_ATTEMPTS - ELEVATED_FAILURE_MIN_ATTEMPTS / 4,
  });
  const oneAttemptShort = buildPublishedGarment({
    failureCount: 1,
    tryOnCount: ELEVATED_FAILURE_MIN_ATTEMPTS - 2,
  });
  const belowTheRate = buildPublishedGarment({ failureCount: 1, tryOnCount: 9 });
  const untouched = buildPublishedGarment({ failureCount: 0, tryOnCount: 0 });
  const allFailing = buildPublishedGarment({
    failureCount: ELEVATED_FAILURE_MIN_ATTEMPTS + 2,
    tryOnCount: 0,
  });

  const rows = [flagged, atBoundary, oneAttemptShort, belowTheRate, untouched, allFailing];

  it('counts a flagged piece and every piece past both the attempt floor and the rate', () => {
    expect(idsIn('elevatedFailureRate', rows)).toEqual([flagged.id, atBoundary.id, allFailing.id]);
  });

  it('takes UPSTREAM_NO_GARMENT_DETECTED seriously on the first occurrence (§4.13, §8.3)', () => {
    expect(catalogHealthCohort('elevatedFailureRate').matches(flagged, CONTEXT)).toBe(true);
  });

  it('ignores a rate computed from too few attempts — one of one is 100% and means nothing', () => {
    expect(countIn('elevatedFailureRate', [oneAttemptShort])).toBe(0);
  });

  it('never divides by zero on a garment nobody has tried on', () => {
    expect(countIn('elevatedFailureRate', [untouched])).toBe(0);
  });

  it('sits exactly on the configured rate rather than a hard-coded one', () => {
    const attempts = ELEVATED_FAILURE_MIN_ATTEMPTS * 4;
    const failuresAtRate = (ELEVATED_FAILURE_RATE_PERCENT * attempts) / 100;
    const cohort = catalogHealthCohort('elevatedFailureRate');

    const onTheRate = buildPublishedGarment({
      failureCount: failuresAtRate,
      tryOnCount: attempts - failuresAtRate,
    });
    const justUnder = buildPublishedGarment({
      failureCount: failuresAtRate - 1,
      tryOnCount: attempts - failuresAtRate + 1,
    });

    expect(cohort.matches(onTheRate, CONTEXT)).toBe(true);
    expect(cohort.matches(justUnder, CONTEXT)).toBe(false);
  });

  it('is zero over an empty catalogue', () => {
    expect(countIn('elevatedFailureRate', [])).toBe(0);
  });

  it('states the rate as a multiplication in SQL too, so both halves are integer-exact', () => {
    const sql = catalogHealthCohort('elevatedFailureRate').sql('garment');

    expect(sql).toContain('garment.flaggedForReview = true');
    expect(sql).toContain('garment.tryOnCount + garment.failureCount >= :minAttempts');
    expect(sql).toContain('garment.failureCount * 100');
    expect(sql).toContain(':failureRatePercent * (garment.tryOnCount + garment.failureCount)');
    // No division anywhere: a garment with zero attempts must not be a divide by zero.
    expect(sql).not.toContain('/');

    const params = catalogHealthSqlParams(CONTEXT);
    expect(params.minAttempts).toBe(ELEVATED_FAILURE_MIN_ATTEMPTS);
    expect(params.failureRatePercent).toBe(ELEVATED_FAILURE_RATE_PERCENT);
  });
});

describe('zeroTryOnsIn30Days — A-15, published and nobody has tried it', () => {
  const staleNeverTried = buildPublishedGarment({
    publishedAt: daysAgo(STALE_TRY_ON_DAYS + 10),
    lastTriedAt: null,
  });
  const staleTriedLongAgo = buildPublishedGarment({
    publishedAt: daysAgo(STALE_TRY_ON_DAYS + 40),
    lastTriedAt: daysAgo(STALE_TRY_ON_DAYS + 5),
  });
  const triedRecently = buildPublishedGarment({
    publishedAt: daysAgo(STALE_TRY_ON_DAYS + 10),
    lastTriedAt: daysAgo(2),
  });
  // Published yesterday with no try-ons is not a problem yet — it is a piece published
  // yesterday.
  const freshlyPublished = buildPublishedGarment({ publishedAt: daysAgo(1), lastTriedAt: null });
  const draft = buildGarment({ publishedAt: null, lastTriedAt: null });
  const publishedAtTheCutoff = buildPublishedGarment({
    publishedAt: CONTEXT.staleBefore,
    lastTriedAt: null,
  });

  const rows = [
    staleNeverTried,
    staleTriedLongAgo,
    triedRecently,
    freshlyPublished,
    draft,
    publishedAtTheCutoff,
  ];

  it('counts published pieces past the window with no try-on inside it', () => {
    expect(idsIn('zeroTryOnsIn30Days', rows)).toEqual([
      staleNeverTried.id,
      staleTriedLongAgo.id,
      publishedAtTheCutoff.id,
    ]);
  });

  it('leaves a draft out — a draft nobody tried on is not a fact about the catalogue', () => {
    expect(countIn('zeroTryOnsIn30Days', [draft])).toBe(0);
  });

  it('leaves a piece published inside the window out', () => {
    expect(countIn('zeroTryOnsIn30Days', [freshlyPublished])).toBe(0);
  });

  it('uses a 30-day window measured from the reference instant', () => {
    expect(staleTryOnCutoff(NOW).getTime()).toBe(
      NOW.getTime() - STALE_TRY_ON_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(STALE_TRY_ON_DAYS).toBe(30);
  });

  it('is zero over an empty catalogue', () => {
    expect(countIn('zeroTryOnsIn30Days', [])).toBe(0);
  });

  it('binds the cutoff as a parameter and names both timestamp columns', () => {
    const sql = catalogHealthCohort('zeroTryOnsIn30Days').sql('garment');

    expect(sql).toContain(`garment.publishState = '${PublishState.PUBLISHED}'`);
    expect(sql).toContain('garment.publishedAt IS NOT NULL');
    expect(sql).toContain('garment.publishedAt <= :staleBefore');
    expect(sql).toContain('garment.lastTriedAt IS NULL');
    expect(sql).toContain('garment.lastTriedAt <= :staleBefore');
    expect(catalogHealthSqlParams(CONTEXT).staleBefore).toEqual(CONTEXT.staleBefore);
  });
});

describe('the registry, pinned to its two halves', () => {
  it('registers exactly the four declared ids, in panel order', () => {
    expect(CATALOG_HEALTH_COHORTS.map((cohort) => cohort.id)).toEqual([
      ...CATALOG_HEALTH_COHORT_IDS,
    ]);
  });

  it('refuses an id that is not a cohort rather than returning undefined', () => {
    expect(() =>
      catalogHealthCohort('notACohort' as (typeof CATALOG_HEALTH_COHORT_IDS)[number]),
    ).toThrow(/not a registered catalog-health cohort/);
  });

  it('writes every column in TypeORM alias form, so a column rename cannot pass silently', () => {
    // `alias.propertyName` is rewritten by the query builder into the real quoted column.
    // A hand-quoted `"publishState"` would stop matching the day a migration renames one,
    // and the query would still parse.
    const columns = new Set(Object.keys(buildGarment()));

    for (const cohort of [...CATALOG_HEALTH_COHORTS]) {
      const referenced = [...cohort.sql('garment').matchAll(/garment\.(\w+)/g)].map(
        (match) => match[1],
      );

      expect(referenced.length).toBeGreaterThan(0);
      for (const column of referenced) {
        expect(columns).toContain(column);
      }
      expect(cohort.sql('garment')).not.toContain('"');
    }
  });

  it('binds only parameters the params builder supplies', () => {
    const supplied = new Set(Object.keys(catalogHealthSqlParams(CONTEXT)));

    for (const cohort of [...CATALOG_HEALTH_COHORTS]) {
      for (const match of cohort.sql('garment').matchAll(/:(\w+)/g)) {
        expect(supplied).toContain(match[1]);
      }
    }
  });

  it('orders every sample by a real column of the row it is sampling', () => {
    const columns = new Set(Object.keys(buildGarment()));

    for (const cohort of [...CATALOG_HEALTH_COHORTS]) {
      expect(columns).toContain(String(cohort.sampleOrderBy));
      expect(['ASC', 'DESC']).toContain(cohort.sampleOrder);
    }
  });
});
