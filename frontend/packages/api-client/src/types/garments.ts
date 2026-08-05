/**
 * ARCHITECTURE.md §5.6 `garments` (admin) and §4.13.
 *
 * Written against `modules/garments/dto/**` — the running API. The consumer-facing projection of a
 * garment is a different shape entirely (see `catalog.ts`); nothing in this file is ever rendered
 * on a consumer route.
 */

import type { IsoDateTime, PaginationQuery, Uuid } from './common';
import type { EmbellishmentWeight, GarmentMode, PublishState, TestRenderState } from './enums';

/* ------------------------------------------------------------------ A-10 image quality */

/** The closed A-10 check set — `garments/validators/image-quality.constants.ts`. */
export const QUALITY_CHECK_IDS = [
  'LONG_EDGE',
  'DOMINANT_GARMENT',
  'BACKGROUND_UNIFORMITY',
  'ASPECT_RATIO',
  'FORMAT',
] as const;
export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number];

/**
 * One A-10 check outcome.
 *
 * `score` is always sent — it is this check's contribution to the 0–100 total, not an optional
 * extra. `remediation` is server-authored, user-safe copy and is present only on a failure
 * (§10.5, D-7).
 */
export interface GarmentQualityCheck {
  check: string;
  passed: boolean;
  score: number;
  remediation: string | null;
}

export const QUALITY_VERDICTS = ['READY', 'NEEDS_BETTER_PHOTO'] as const;
export type QualityVerdict = (typeof QUALITY_VERDICTS)[number];

/** `ImageQualityReportDto` — the verdict for a try-on source (§5.7, A-10). */
export interface ImageQualityReport {
  /** Persisted as `garments.qualityScore`. */
  score: number;
  /** The pass mark this was judged against — `quality.minScore`. */
  minScore: number;
  /** `score >= minScore`. Publishing below this needs an override. */
  passed: boolean;
  verdict: QualityVerdict;
  /** True when the garment is marked "Needs a better photo" (A-10). */
  needsBetterPhoto: boolean;
  /** A-10's own label, word for word, served by the API so the console cannot drift from it. */
  label: string;
  checks: GarmentQualityCheck[];
}

/** Minimum length the API enforces on an A-10 override reason, so the form can say so first. */
export const MIN_OVERRIDE_REASON_LENGTH = 10;

/* ------------------------------------------------------------------ the garment */

/**
 * `GarmentResponseDto` — **one shape for the list rows and the detail screen**.
 *
 * There is no `thumbnailUrl` on this DTO and no embedded `images` array: the gallery is a separate
 * `GET /admin/garments/:garmentId/images` call, and the table's row thumbnails come from
 * `POST /admin/garment-images/batch` (§6.2). `qualityOverriddenBy` and `approvedBy` are **ids**,
 * not display names.
 */
export interface AdminGarment {
  id: Uuid;
  sku: string;
  title: string;
  titleUr: string | null;
  slug: string;
  categoryId: Uuid;
  /** Denormalised for the list screen. */
  categoryName: string | null;
  colors: string[];
  fabric: string | null;
  embellishmentWeight: EmbellishmentWeight;
  price: number;
  currency: string;
  mode: GarmentMode;
  /** Set only when `mode === 'RENTAL'` (§4.13). */
  deposit: number | null;
  description: string | null;
  descriptionUr: string | null;
  sizes: string[];
  styleTags: string[];
  publishState: PublishState;
  publishedAt: IsoDateTime | null;
  /** 0–100 (A-10). Null before the try-on source has been scored. */
  qualityScore: number | null;
  /** Always an array — empty, never null. */
  qualityChecks: GarmentQualityCheck[];
  qualityOverridden: boolean;
  qualityOverriddenBy: Uuid | null;
  qualityOverriddenAt: IsoDateTime | null;
  testRenderId: Uuid | null;
  testRenderState: TestRenderState;
  testRenderApprovedAt: IsoDateTime | null;
  approvedBy: Uuid | null;
  /** Set by `UPSTREAM_NO_GARMENT_DETECTED` (A-15). */
  flaggedForReview: boolean;
  /**
   * Whether the A-11 and A-10 publish gates would currently pass. The console disables Publish
   * from this rather than offering an action the API will refuse (D-5).
   */
  publishable: boolean;
  tryOnCount: number;
  loveCount: number;
  maybeCount: number;
  rejectCount: number;
  enquiryCount: number;
  failureCount: number;
  /** Love share of all verdicts cast, 0–1. Null before the first verdict (A-14). */
  starRate: number | null;
  lastTriedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/* ------------------------------------------------------------------ listing (A-14) */

/**
 * `GARMENT_SORT_KEYS` — the allow-list the query builder accepts.
 *
 * A-14 names three sorts by label ("newest", "most tried", "highest star rate"); each is a
 * `sortBy` + `sortOrder` pair on the wire. There is no `sort` parameter taking those labels.
 */
export const GARMENT_SORT_KEYS = [
  'createdAt',
  'updatedAt',
  'publishedAt',
  'tryOnCount',
  'starRate',
  'title',
  'price',
] as const;
export type GarmentSortKey = (typeof GARMENT_SORT_KEYS)[number];

export interface AdminGarmentListQuery extends PaginationQuery {
  /** Case-insensitive partial match on title, SKU or style tag. */
  search?: string;
  categoryId?: Uuid;
  publishState?: PublishState;
  mode?: GarmentMode;
  flaggedForReview?: boolean;
  sortBy?: GarmentSortKey;
}

/* ------------------------------------------------------------------ writes */

export const MAX_COLORS = 12;
export const MAX_SIZES = 20;
export const MAX_STYLE_TAGS = 20;

/** `POST /admin/garments` (ADMIN) — A-7, A-8. */
export interface CreateGarmentRequest {
  sku: string;
  title: string;
  titleUr?: string;
  /** Derived from `title` when omitted, and de-duplicated if taken. */
  slug?: string;
  categoryId: Uuid;
  colors?: string[];
  fabric?: string;
  embellishmentWeight: EmbellishmentWeight;
  price: number;
  /** ISO-4217. Defaults to PKR. */
  currency?: string;
  mode: GarmentMode;
  /** Required when `mode === 'RENTAL'`, refused otherwise (A-8, §4.13). */
  deposit?: number;
  description?: string;
  descriptionUr?: string;
  sizes?: string[];
  styleTags?: string[];
}

/** `PATCH /admin/garments/:garmentId`. `null` clears a nullable field; an absent key leaves it. */
export interface UpdateGarmentRequest {
  sku?: string;
  title?: string;
  titleUr?: string | null;
  slug?: string;
  categoryId?: Uuid;
  colors?: string[];
  fabric?: string | null;
  embellishmentWeight?: EmbellishmentWeight;
  price?: number;
  currency?: string;
  mode?: GarmentMode;
  deposit?: number | null;
  description?: string | null;
  descriptionUr?: string | null;
  sizes?: string[];
  styleTags?: string[];
}

/**
 * `DELETE /admin/garments/:garmentId` — 204, D-17.
 *
 * The field is `confirmTitle` and the **API** compares it to the garment title, case- and
 * whitespace-insensitively. The dialog is not the safeguard.
 */
export interface DeleteGarmentRequest {
  confirmTitle: string;
}

/** `POST /admin/garments/:garmentId/quality-override` — becomes the `GARMENT_QUALITY_OVERRIDDEN` audit row. */
export interface QualityOverrideRequest {
  reason: string;
}

/* ------------------------------------------------------------------ bulk (A-12, D-16) */

export const GARMENT_BULK_ACTIONS = ['PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RECATEGORISE'] as const;
export type GarmentBulkAction = (typeof GARMENT_BULK_ACTIONS)[number];

/** One bulk write covers at most this many rows; a longer list is refused, not truncated. */
export const MAX_BULK_GARMENTS = 100;

/** `POST /admin/garments/bulk`. The discriminator is `action`, not `operation`. */
export interface BulkGarmentRequest {
  action: GarmentBulkAction;
  garmentIds: Uuid[];
  /** Required when `action === 'RECATEGORISE'`. */
  categoryId?: Uuid;
}

/** The per-item outcome D-16 renders. The keys are `garmentId` / `succeeded`. */
export interface BulkGarmentItemResult {
  garmentId: Uuid;
  succeeded: boolean;
  errorCode: string | null;
  /** Already user-safe (§2.3). */
  message: string | null;
}

export interface BulkGarmentResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkGarmentItemResult[];
}

/* ------------------------------------------------------------------ catalog health (A-15) */

export const CATALOG_HEALTH_COHORT_IDS = [
  'missingTestRender',
  'lowQualityScore',
  'elevatedFailureRate',
  'zeroTryOnsIn30Days',
] as const;
export type CatalogHealthCohortId = (typeof CATALOG_HEALTH_COHORT_IDS)[number];

/** Example rows returned per cohort. `0` returns counts only; a larger value is refused. */
export const DEFAULT_CATALOG_HEALTH_SAMPLE = 10;
export const MAX_CATALOG_HEALTH_SAMPLE = 50;

export interface CatalogHealthQuery {
  sample?: number;
}

export interface CatalogHealthCohort {
  /** The true total across the catalogue, aggregated in SQL — not a page count. */
  total: number;
  /** At most `sample` rows, ordered worst-first for this cohort. */
  items: AdminGarment[];
}

/** The thresholds the cohorts were evaluated against, served so the panel cannot drift from them. */
export interface CatalogHealthThresholds {
  /** `quality.minScore` (A-10). */
  minQualityScore: number;
  /** Attempts needed before a failure rate is meaningful. */
  minFailureAttempts: number;
  failureRatePercent: number;
  /** A-15's window, in days. */
  staleTryOnDays: number;
}

/**
 * `GET /admin/catalog-health` (ADMIN) — the whole A-15 panel in one response.
 *
 * Archived pieces are out of scope: they were retired on purpose (A-13).
 */
export interface CatalogHealth {
  generatedAt: IsoDateTime;
  /** Live, non-archived garments the cohorts were evaluated over. */
  inspected: number;
  /** The `sample` actually applied. */
  sampleLimit: number;
  thresholds: CatalogHealthThresholds;
  /** A-11 — no approved test render. */
  missingTestRender: CatalogHealthCohort;
  /** A-10 — below the pass mark. */
  lowQualityScore: CatalogHealthCohort;
  /** §8.3 — repeated upstream failures. */
  elevatedFailureRate: CatalogHealthCohort;
  /** Published, untried for `staleTryOnDays`. */
  zeroTryOnsIn30Days: CatalogHealthCohort;
}
