import { MILLISECONDS_PER_DAY } from '@library/common';

import { PublishState } from '../enums/publish-state.enum';
import { TestRenderState } from '../enums/test-render-state.enum';

import { hasApprovedTestRender } from './garment-publish.gate';

import type { Garment } from '../entities/garment.entity';

/**
 * **The four A-15 cohorts, defined once — PRD A-15, ARCHITECTURE §5.6.**
 *
 * > "Catalog health panel: garments missing an approved test render, low quality
 * > scores, elevated generation failure rates, and zero try-ons in 30 days."
 *
 * ### Why each cohort is declared twice
 *
 * The panel must report **true totals**, which means the counting happens in
 * PostgreSQL — `COUNT(*) FILTER (WHERE …)`, one pass, no rows in memory. SQL is not
 * executable in this test suite (there is no database on the development machine,
 * CLAUDE.md), so a cohort that existed only as a SQL string would have its arithmetic
 * verified by nobody.
 *
 * So every cohort carries both halves: the `sql` fragment the aggregate query uses,
 * and a pure `matches()` predicate over a row. `catalog-health.cohorts.spec.ts` runs
 * the predicate over a fixed fixture set — that is the arithmetic — and pins the two
 * halves to the same columns and the same thresholds, so a change to one that is not
 * made to the other fails.
 *
 * This is the pattern the codebase already uses where a rule has to hold in both
 * places: `STAR_RATE_SQL` beside `starRateOf()` (A-14), and the publish gate's
 * `hasApprovedTestRender()` beside the catalogue module's visibility predicate (E-10).
 *
 * ### The scope every cohort is evaluated inside
 *
 * Live, non-archived garments. A soft-deleted row is not catalogue any more, and an
 * archived piece was retired on purpose (A-13) — listing it as "missing a test render"
 * every day would train an admin to ignore the panel, which is the one failure mode a
 * health panel cannot survive. {@link catalogHealthScopeSql} is that predicate, and
 * {@link isInCatalogHealthScope} is its pure twin.
 */

/* ---------------------------------------------------------------------------------------------
 * Thresholds
 * ------------------------------------------------------------------------------------------ */

/**
 * How many attempts a garment needs before a failure *rate* means anything.
 *
 * One failure out of one attempt is 100% and tells an admin nothing worth acting on.
 * Below this floor the piece is simply new.
 */
export const ELEVATED_FAILURE_MIN_ATTEMPTS = 4;

/** Percentage of attempts that must have failed for the rate to count as elevated. */
export const ELEVATED_FAILURE_RATE_PERCENT = 25;

/** A-15's window: "zero try-ons in 30 days". */
export const STALE_TRY_ON_DAYS = 30;

/** Default size of the per-cohort sample. Bounded so one admin cannot ask for the catalogue. */
export const DEFAULT_CATALOG_HEALTH_SAMPLE = 10;

/** Ceiling on the per-cohort sample. Rejected by the DTO above this (§2.8). */
export const MAX_CATALOG_HEALTH_SAMPLE = 50;

/* ---------------------------------------------------------------------------------------------
 * Scope
 * ------------------------------------------------------------------------------------------ */

/**
 * The rows every cohort is evaluated over. See the note above for why `ARCHIVED` is out.
 *
 * Written in TypeORM's `alias.propertyName` form throughout this file, never as quoted
 * column names: the query builder rewrites that form into the real, quoted column, and
 * a hand-quoted `"publishState"` would silently stop matching the day a column is
 * renamed in a migration.
 */
export function catalogHealthScopeSql(alias: string): string {
  return `${alias}.deletedAt IS NULL AND ${alias}.publishState <> '${PublishState.ARCHIVED}'`;
}

/** The pure twin of {@link catalogHealthScopeSql}. */
export function isInCatalogHealthScope(garment: Garment): boolean {
  return garment.deletedAt === null && garment.publishState !== PublishState.ARCHIVED;
}

/* ---------------------------------------------------------------------------------------------
 * Cohorts
 * ------------------------------------------------------------------------------------------ */

/** The four cohort ids. Also the keys of the response DTO, so the two cannot drift. */
export const CATALOG_HEALTH_COHORT_IDS = [
  'missingTestRender',
  'lowQualityScore',
  'elevatedFailureRate',
  'zeroTryOnsIn30Days',
] as const;

export type CatalogHealthCohortId = (typeof CATALOG_HEALTH_COHORT_IDS)[number];

/** Everything a cohort predicate needs that is not on the row. */
export interface CatalogHealthContext {
  /** `quality.minScore` from `SettingsService` (A-10). */
  readonly minQualityScore: number;
  /** Rows last tried before this instant count as stale. */
  readonly staleBefore: Date;
}

/** The bound parameters the SQL half of every cohort refers to. */
export interface CatalogHealthSqlParams {
  readonly minQualityScore: number;
  readonly staleBefore: Date;
  readonly minAttempts: number;
  readonly failureRatePercent: number;
}

/** Builds the parameter object from the same context the predicates read. */
export function catalogHealthSqlParams(context: CatalogHealthContext): CatalogHealthSqlParams {
  return {
    minQualityScore: context.minQualityScore,
    staleBefore: context.staleBefore,
    minAttempts: ELEVATED_FAILURE_MIN_ATTEMPTS,
    failureRatePercent: ELEVATED_FAILURE_RATE_PERCENT,
  };
}

export interface CatalogHealthCohort {
  readonly id: CatalogHealthCohortId;
  /** The column the sample is ordered by, so "the worst ten" is a stable, indexed answer. */
  readonly sampleOrderBy: keyof Garment;
  readonly sampleOrder: 'ASC' | 'DESC';
  /** The `WHERE` fragment, in terms of `alias` and the {@link CatalogHealthSqlParams} names. */
  sql(alias: string): string;
  /** The pure twin of {@link sql}. */
  matches(garment: Garment, context: CatalogHealthContext): boolean;
}

/**
 * A-11 / E-10 — no approved test render, so the piece cannot be published at all.
 *
 * The predicate is the **negation of `hasApprovedTestRender()` itself**, imported from
 * the publish gate rather than re-derived. It used to be spelled out here with a comment
 * saying "exactly as `hasApprovedTestRender()` requires them", which is the shape of a
 * bug waiting for the gate to gain a third condition: the panel would go on reporting a
 * garment as healthy that the gate refuses to publish, and an admin would be told the
 * work list is empty while nothing could be published. The SQL half still spells both
 * columns out because it has to run in PostgreSQL — the spec pins the two together.
 */
const missingTestRender: CatalogHealthCohort = {
  id: 'missingTestRender',
  sampleOrderBy: 'updatedAt',
  sampleOrder: 'DESC',
  sql: (alias) =>
    `(${alias}.testRenderState <> '${TestRenderState.APPROVED}' ` +
    `OR ${alias}.testRenderApprovedAt IS NULL)`,
  matches: (garment) => !hasApprovedTestRender(garment),
};

/**
 * A-10 — a recorded quality score below the pass mark, with no override.
 *
 * An **unscored** garment is deliberately not in this cohort. The publish gate treats
 * `null` as below threshold, and it is right to: absence of a verdict is not evidence
 * of a good photograph. But this is a work list, and a piece nobody has photographed
 * yet is not a *low score* — it is a piece with no source image, which is what the
 * missing-test-render cohort is already telling the admin. Counting it twice would
 * make the "low quality" number a headline about drafts.
 *
 * An overridden garment drops out: an admin has already looked at it and accepted the
 * score on the record (A-10), and re-listing it is asking the same question again.
 */
const lowQualityScore: CatalogHealthCohort = {
  id: 'lowQualityScore',
  sampleOrderBy: 'qualityScore',
  sampleOrder: 'ASC',
  sql: (alias) =>
    `(${alias}.qualityScore IS NOT NULL ` +
    `AND ${alias}.qualityScore < :minQualityScore ` +
    `AND (${alias}.qualityOverriddenBy IS NULL OR ${alias}.qualityOverriddenAt IS NULL))`,
  matches: (garment, context) =>
    garment.qualityScore !== null &&
    garment.qualityScore < context.minQualityScore &&
    (garment.qualityOverriddenBy === null || garment.qualityOverriddenAt === null),
};

/**
 * A-15 "elevated generation failure rates", §8.3.
 *
 * Two ways in, because they are two different signals:
 *
 *  - **`flaggedForReview`** is set by `UPSTREAM_NO_GARMENT_DETECTED` (§8.3, §4.13). It
 *    is the upstream saying it could not find a garment in the photograph at all, and
 *    one of those is worth an admin's attention immediately.
 *  - **A rate**, for everything else: at least {@link ELEVATED_FAILURE_MIN_ATTEMPTS}
 *    attempts, of which at least {@link ELEVATED_FAILURE_RATE_PERCENT}% failed.
 *
 * The rate is written as a multiplication rather than a division so it is exact
 * integer arithmetic in both halves — `failureCount * 100 >= percent * attempts` — and
 * so a garment with zero attempts can never divide by zero.
 */
const elevatedFailureRate: CatalogHealthCohort = {
  id: 'elevatedFailureRate',
  sampleOrderBy: 'failureCount',
  sampleOrder: 'DESC',
  sql: (alias) =>
    `(${alias}.flaggedForReview = true OR (` +
    `${alias}.tryOnCount + ${alias}.failureCount >= :minAttempts ` +
    `AND ${alias}.failureCount * 100 >= ` +
    `:failureRatePercent * (${alias}.tryOnCount + ${alias}.failureCount)))`,
  matches: (garment) => {
    if (garment.flaggedForReview) {
      return true;
    }
    const attempts = garment.tryOnCount + garment.failureCount;
    return (
      attempts >= ELEVATED_FAILURE_MIN_ATTEMPTS &&
      garment.failureCount * 100 >= ELEVATED_FAILURE_RATE_PERCENT * attempts
    );
  },
};

/**
 * A-15 "zero try-ons in 30 days" — published, and nobody has tried it on since.
 *
 * Scoped to `PUBLISHED` because a draft nobody has tried on is not a fact about the
 * catalogue, and gated on `publishedAt` being at least the window old: a piece
 * published yesterday with no try-ons is not a problem yet, it is a piece published
 * yesterday.
 */
const zeroTryOnsIn30Days: CatalogHealthCohort = {
  id: 'zeroTryOnsIn30Days',
  sampleOrderBy: 'publishedAt',
  sampleOrder: 'ASC',
  sql: (alias) =>
    `(${alias}.publishState = '${PublishState.PUBLISHED}' ` +
    `AND ${alias}.publishedAt IS NOT NULL ` +
    `AND ${alias}.publishedAt <= :staleBefore ` +
    `AND (${alias}.lastTriedAt IS NULL OR ${alias}.lastTriedAt <= :staleBefore))`,
  matches: (garment, context) =>
    garment.publishState === PublishState.PUBLISHED &&
    garment.publishedAt !== null &&
    garment.publishedAt.getTime() <= context.staleBefore.getTime() &&
    (garment.lastTriedAt === null ||
      garment.lastTriedAt.getTime() <= context.staleBefore.getTime()),
};

/** The registry, in the order the panel reads top to bottom. */
export const CATALOG_HEALTH_COHORTS: readonly CatalogHealthCohort[] = [
  missingTestRender,
  lowQualityScore,
  elevatedFailureRate,
  zeroTryOnsIn30Days,
];

/** One cohort by id. Throws rather than returning `undefined`; the ids are a closed set. */
export function catalogHealthCohort(id: CatalogHealthCohortId): CatalogHealthCohort {
  const cohort = CATALOG_HEALTH_COHORTS.find((candidate) => candidate.id === id);
  if (cohort === undefined) {
    throw new Error(`"${id}" is not a registered catalog-health cohort.`);
  }
  return cohort;
}

/** The instant before which a try-on counts as stale, from a reference "now". */
export function staleTryOnCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_TRY_ON_DAYS * MILLISECONDS_PER_DAY);
}
