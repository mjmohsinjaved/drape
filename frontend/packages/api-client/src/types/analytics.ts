/**
 * ARCHITECTURE.md §5.18 `analytics` (A-1, A-36–A-39, E-13).
 *
 * §4.13: analytics endpoints compute from source tables, **never** from the denormalised counters
 * on `garments`. Those counters exist for sorting and catalog health only.
 */

import { type DateRangeQuery, type IsoDateTime, type LedgerPeriod, type Uuid } from './common';
import { type RejectReason } from './enums';

/** The shared range selector for every analytics endpoint. */
export interface AnalyticsRangeQuery extends DateRangeQuery {
  /** A named preset the API resolves to a window; `from`/`to` win when both are supplied. */
  preset?: AnalyticsPreset;
}

export const ANALYTICS_PRESETS = ['LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH'] as const;
export type AnalyticsPreset = (typeof ANALYTICS_PRESETS)[number];

/** `GET /admin/analytics/overview` (ADMIN) — the A-1 landing tiles. */
export interface AnalyticsOverview {
  newEnquiries: number;
  budgetUsedPercent: number;
  budgetPeriod: LedgerPeriod;
  garmentsAwaitingTestRender: number;
  itemsFlaggedForReview: number;
  generatedAt: IsoDateTime;
}

/**
 * `GET /admin/analytics/funnel` (ADMIN) — A-36:
 * signups → email verified → photo uploaded → first try-on → ≥1 star → enquiry.
 */
export interface AnalyticsFunnel {
  from: IsoDateTime;
  to: IsoDateTime;
  steps: AnalyticsFunnelStep[];
}

export const FUNNEL_STEPS = [
  'SIGNED_UP',
  'EMAIL_VERIFIED',
  'PHOTO_UPLOADED',
  'FIRST_TRY_ON',
  'AT_LEAST_ONE_LOVE',
  'ENQUIRY_SENT',
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface AnalyticsFunnelStep {
  step: FunnelStep;
  count: number;
  /** Share of the previous step, 0–1. `1` on the first step. */
  conversionFromPrevious: number;
  /** Share of the first step, 0–1. */
  conversionFromStart: number;
}

/** `GET /admin/analytics/garments` (ADMIN) — the A-37 leaderboard. */
export interface AnalyticsGarmentsResponse {
  from: IsoDateTime;
  to: IsoDateTime;
  rows: AnalyticsGarmentRow[];
}

export interface AnalyticsGarmentRow {
  garmentId: Uuid;
  sku: string;
  title: string;
  categoryName: string;
  thumbnailUrl: string | null;
  tryOnCount: number;
  /** `LOVE_IT` share of verdicts, 0–1. */
  starRate: number;
  /** `NOT_FOR_ME` share of verdicts, 0–1. */
  rejectRate: number;
  /** Share of try-ons that ended in an enquiry, 0–1. */
  enquiryRate: number;
}

/** `GET /admin/analytics/rejection-reasons` (ADMIN) — A-38 rollup. */
export interface AnalyticsRejectionReasons {
  from: IsoDateTime;
  to: IsoDateTime;
  total: number;
  rows: AnalyticsRejectionRow[];
}

export interface AnalyticsRejectionRow {
  reason: RejectReason;
  count: number;
  /** Share of all rejections in the window, 0–1. */
  share: number;
}

/** `GET /admin/analytics/categories` (ADMIN) — A-39 category performance. */
export interface AnalyticsCategoriesResponse {
  from: IsoDateTime;
  to: IsoDateTime;
  rows: AnalyticsCategoryRow[];
}

export interface AnalyticsCategoryRow {
  categoryId: Uuid;
  categoryName: string;
  publishedGarmentCount: number;
  tryOnCount: number;
  starRate: number;
  enquiryCount: number;
}

/** `GET /admin/analytics/activity` (ADMIN) — activity by hour and day (A-39). */
export interface AnalyticsActivity {
  from: IsoDateTime;
  to: IsoDateTime;
  /** Timezone the buckets were computed in — `TIMEZONE`, i.e. `Asia/Karachi`. */
  timezone: string;
  byHour: AnalyticsActivityBucket[];
  byDayOfWeek: AnalyticsActivityBucket[];
}

export interface AnalyticsActivityBucket {
  /** `0`–`23` for `byHour`; `0` (Sunday) – `6` for `byDayOfWeek`. */
  bucket: number;
  tryOnCount: number;
  sessionCount: number;
}

/** `GET /admin/analytics/generation-health` (ADMIN) — E-13. */
export interface AnalyticsGenerationHealth {
  from: IsoDateTime;
  to: IsoDateTime;
  latencyMs: {
    p50: number;
    p90: number;
    p99: number;
    max: number;
  };
  totalJobs: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** Share of jobs served from `tryon_cache`, 0–1 (§3.7). */
  cacheHitRate: number;
  failuresByErrorCode: AnalyticsFailureRow[];
}

export interface AnalyticsFailureRow {
  /** An §2.4 `ErrorCode` value. */
  errorCode: string;
  count: number;
  share: number;
}
