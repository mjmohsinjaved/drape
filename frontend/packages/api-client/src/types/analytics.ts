/**
 * ARCHITECTURE.md §5.18 `analytics` (A-1, A-36–A-39, E-13).
 *
 * §4.13: analytics endpoints compute from source tables, **never** from the denormalised counters
 * on `garments`. Those counters exist for sorting and catalog health only.
 *
 * Every rate and share on this file (`starRate`, `rejectRate`, `conversionFromStart`, …) is a
 * **percentage, 0–100**, not a 0–1 fraction — that is how `AdminAnalyticsController`'s DTOs declare
 * them (e.g. `example: 46.3`).
 */

import type { DateRangeQuery, IsoDateTime, Uuid } from './common';
import type { RejectReason } from './enums';
import type { BudgetSnapshot } from './quota';

/**
 * The shared window every `GET /admin/analytics/*` route takes. `days` (1–366, server default 30)
 * is the ergonomic form; `from`/`to` (ISO-8601 instants) are the precise one and win when given.
 */
export interface AnalyticsRangeQuery extends DateRangeQuery {
  days?: number;
}

/** `GET /admin/analytics/garments` and `.../categories` (A-37, A-39) — adds the leaderboard size. */
export interface AnalyticsLeaderboardQuery extends AnalyticsRangeQuery {
  /** Rows to return, 1–100. Server default 25 — a leaderboard is a top list, not an export. */
  limit?: number;
}

/** One A-33 usage snapshot, embedded on `AnalyticsOverview` — the only place cache-hit figures live. */
export interface AnalyticsUsageSnapshot {
  budget: BudgetSnapshot;
  /** Consumer try-ons charged this period (A-33). */
  consumerGenerations: number;
  /** Admin test renders charged this period (A-33). */
  testRenders: number;
  /** Generations per day over the trailing 7 days. */
  trailingDailyRate: number;
  /** Null when the rate is zero, the budget is already spent, or it lasts past the period boundary. */
  projectedExhaustionAt: IsoDateTime | null;
  /** Days of budget left at the trailing rate. Null when the rate is zero. */
  daysRemaining: number | null;
  /** Generations served from `tryon_cache` in the window — charged nothing (C-22). */
  cacheHits: number;
  /** Generations that actually reached the upstream and cost money. */
  billedCalls: number;
  /** Cache hits as a percentage of all completed generations (E-13). */
  cacheHitRate: number;
}

/** `GET /admin/analytics/overview` (ADMIN) — the A-1 landing tiles, with the A-33 usage block. */
export interface AnalyticsOverview {
  /** Enquiries still at `NEW` (A-1). */
  newEnquiries: number;
  /** Enquiries untouched for more than 24 hours — the A-25 stale highlight. */
  staleEnquiries: number;
  garmentsAwaitingTestRender: number;
  garmentsFlaggedForReview: number;
  /** Moderation items pending a decision (A-1, A-34). */
  moderationItemsPending: number;
  usage: AnalyticsUsageSnapshot;
}

/** The A-36 signup funnel, in order (mirrors `@library/common`'s `FUNNEL_STEPS`). */
export const FUNNEL_STEPS = [
  'SIGNUP',
  'EMAIL_VERIFIED',
  'PHOTO_UPLOADED',
  'FIRST_TRYON',
  'SHORTLISTED',
  'ENQUIRY',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface AnalyticsFunnelStep {
  step: FunnelStep;
  count: number;
  /** Percent of the signup cohort that reached here. */
  conversionFromStart: number;
  /** Percent of the previous step that reached here. */
  conversionFromPrevious: number;
  /** Consumers lost since the previous step. */
  droppedFromPrevious: number;
}

/**
 * `GET /admin/analytics/funnel` (ADMIN) — A-36: a **cohort** funnel. Every step counts consumers
 * who signed up inside the window, whenever they reached that step.
 */
export interface AnalyticsFunnel {
  from: IsoDateTime;
  to: IsoDateTime;
  /** The signup cohort. Every step counts members of *this* set (A-36). */
  cohortSize: number;
  steps: AnalyticsFunnelStep[];
}

/** One row of the A-37 leaderboard. */
export interface AnalyticsGarmentRow {
  garmentId: Uuid;
  title: string;
  categoryName: string | null;
  tryOns: number;
  /** `LOVE_IT` or `MAYBE` (§4.20). */
  stars: number;
  /** `NOT_FOR_ME` (§4.20). */
  rejects: number;
  enquiries: number;
  /** Stars as a percent of **try-ons** (A-37). */
  starRate: number;
  rejectRate: number;
  enquiryRate: number;
  /** Verdicts as a percent of try-ons — a low star rate with low coverage means ignored, not disliked. */
  verdictCoverage: number;
}

/** `GET /admin/analytics/garments` (ADMIN) — the A-37 leaderboard. */
export interface AnalyticsGarmentsResponse {
  from: IsoDateTime;
  to: IsoDateTime;
  /** Try-ons a garment needs before it appears (A-37). */
  minimumTryOns: number;
  garments: AnalyticsGarmentRow[];
}

/** One row of the A-38 rollup. `'UNSTATED'` covers a nullable `rejectReason` (C-21). */
export interface AnalyticsRejectionRow {
  reason: RejectReason | 'UNSTATED';
  count: number;
  /** Percent of all rejections in the window. */
  share: number;
}

/** `GET /admin/analytics/rejection-reasons` (ADMIN) — A-38 rollup. */
export interface AnalyticsRejectionReasons {
  from: IsoDateTime;
  to: IsoDateTime;
  /** `NOT_FOR_ME` verdicts in the window (§4.20). */
  totalRejections: number;
  reasons: AnalyticsRejectionRow[];
}

/** One category's performance (A-39). */
export interface AnalyticsCategoryRow {
  categoryId: Uuid;
  name: string;
  publishedGarments: number;
  tryOns: number;
  stars: number;
  enquiries: number;
  starRate: number;
  enquiryRate: number;
}

/** `GET /admin/analytics/categories` (ADMIN) — A-39 category performance. */
export interface AnalyticsCategoriesResponse {
  from: IsoDateTime;
  to: IsoDateTime;
  categories: AnalyticsCategoryRow[];
}

/** One cell of the A-39 activity grid. Sparse — only cells with activity are returned. */
export interface AnalyticsActivityCell {
  /** `0` = Sunday, matching PostgreSQL `EXTRACT(DOW)`. */
  dayOfWeek: number;
  /** `0`–`23`, in `TIMEZONE`. */
  hour: number;
  generations: number;
}

/** `GET /admin/analytics/activity` (ADMIN) — activity by hour and day (A-39). */
export interface AnalyticsActivity {
  from: IsoDateTime;
  to: IsoDateTime;
  /** `TIMEZONE`, i.e. `Asia/Karachi` — the grid is local, not UTC. */
  timeZone: string;
  cells: AnalyticsActivityCell[];
  /** Busiest hour in the window. */
  peakHour: number;
  /** Busiest day of week in the window. */
  peakDayOfWeek: number;
}

/** One latency bucket (E-13). */
export interface AnalyticsLatencyBucket {
  /** Upper bound in ms. Null on the last, unbounded bucket. */
  upperBoundMs: number | null;
  count: number;
}

/** One error code and how often it happened (E-13). */
export interface AnalyticsFailureRow {
  errorCode: string;
  count: number;
  /** Percent of all generations in the window. */
  rate: number;
}

/** `GET /admin/analytics/generation-health` (ADMIN) — E-13. */
export interface AnalyticsGenerationHealth {
  from: IsoDateTime;
  to: IsoDateTime;
  total: number;
  succeeded: number;
  failed: number;
  /** E-14 alerts above 4%. */
  failureRatePercent: number;
  /** Cache hits as a percent of completed jobs (E-13). */
  cacheHitRate: number;
  /** Median end-to-end duration in ms. */
  p50LatencyMs: number;
  p95LatencyMs: number;
  latencyBuckets: AnalyticsLatencyBucket[];
  failuresByCode: AnalyticsFailureRow[];
}
