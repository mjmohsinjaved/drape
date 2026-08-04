/**
 * ARCHITECTURE.md §5.6 `garments` (admin) and §4.13.
 *
 * The consumer-facing projection of a garment is a different shape entirely — see `catalog.ts`.
 * Nothing in this file is ever rendered on a consumer route.
 */

import {
  type BulkOperationResult,
  type IsoDateTime,
  type QualityCheckResult,
  type SearchablePaginationQuery,
  type Uuid,
} from './common';
import {
  type EmbellishmentWeight,
  type GarmentMode,
  type PublishState,
  type TestRenderState,
} from './enums';
import { type GarmentImage } from './garment-images';

/** One row of `GET /admin/garments` (ADMIN) — the catalog list of A-14. */
export interface AdminGarmentListItem {
  id: Uuid;
  sku: string;
  title: string;
  titleUr: string | null;
  slug: string;
  categoryId: Uuid;
  categoryName: string;
  price: number;
  currency: string;
  mode: GarmentMode;
  embellishmentWeight: EmbellishmentWeight;
  publishState: PublishState;
  publishedAt: IsoDateTime | null;
  testRenderState: TestRenderState;
  qualityScore: number | null;
  flaggedForReview: boolean;
  /** Signed URL for the gallery-leading thumbnail, or null when the garment has no image yet. */
  thumbnailUrl: string | null;
  tryOnCount: number;
  loveCount: number;
  maybeCount: number;
  rejectCount: number;
  enquiryCount: number;
  failureCount: number;
  lastTriedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `GET /admin/garments/:garmentId` (ADMIN) — full garment, images, quality report, test render. */
export interface AdminGarmentDetail extends AdminGarmentListItem {
  colors: string[];
  fabric: string | null;
  deposit: number | null;
  description: string | null;
  descriptionUr: string | null;
  sizes: string[];
  styleTags: string[];
  images: GarmentImage[];
  qualityChecks: QualityCheckResult[] | null;
  qualityOverriddenByName: string | null;
  qualityOverriddenAt: IsoDateTime | null;
  testRender: GarmentTestRender | null;
  testRenderApprovedAt: IsoDateTime | null;
  approvedByName: string | null;
}

/** The stored A-11 test render attached to a garment. */
export interface GarmentTestRender {
  resultId: Uuid;
  referenceModelId: Uuid | null;
  referenceModelLabel: string | null;
  /** Signed URL (§3.4) for the rendered image. */
  imageUrl: string;
  thumbnailUrl: string | null;
  state: TestRenderState;
  rejectedReason: string | null;
  createdAt: IsoDateTime;
}

export const ADMIN_GARMENT_SORTS = ['newest', 'mostTried', 'highestStarRate'] as const;
export type AdminGarmentSort = (typeof ADMIN_GARMENT_SORTS)[number];

/** `GET /admin/garments` query — search, category, publish state, and the three A-14 sorts. */
export interface AdminGarmentListQuery extends SearchablePaginationQuery {
  categoryId?: Uuid;
  publishState?: PublishState;
  testRenderState?: TestRenderState;
  flaggedForReview?: boolean;
  /** A-14 names three sorts; they map onto `sortBy` and are mutually exclusive with it. */
  sort?: AdminGarmentSort;
}

/** `POST /admin/garments` (ADMIN) — A-8. `deposit` is required when `mode = RENTAL` (§4.13). */
export interface CreateGarmentRequest {
  sku: string;
  title: string;
  titleUr?: string | null;
  slug?: string;
  categoryId: Uuid;
  colors?: string[];
  fabric?: string | null;
  embellishmentWeight: EmbellishmentWeight;
  price: number;
  currency?: string;
  mode: GarmentMode;
  deposit?: number | null;
  description?: string | null;
  descriptionUr?: string | null;
  sizes?: string[];
  styleTags?: string[];
}

/** `PATCH /admin/garments/:garmentId` (ADMIN). `publishState` is never patched here — use the actions. */
export type UpdateGarmentRequest = Partial<CreateGarmentRequest>;

/** `DELETE /admin/garments/:garmentId` (ADMIN). D-17 requires typing the title. */
export interface DeleteGarmentRequest {
  /** Must match the garment title exactly. */
  confirmation: string;
}

/**
 * `POST /admin/garments/:garmentId/publish` (ADMIN). Enforces the A-11 test-render gate
 * (`TEST_RENDER_REQUIRED`) and the A-10 quality gate (`QUALITY_OVERRIDE_REQUIRED`), and requires a
 * try-on source image (`TRYON_SOURCE_REQUIRED`).
 */
export interface PublishGarmentResponse {
  id: Uuid;
  publishState: PublishState;
  publishedAt: IsoDateTime;
}

/** `POST /admin/garments/:garmentId/quality-override` (ADMIN) — A-10. The reason is required. */
export interface QualityOverrideRequest {
  reason: string;
}

export const GARMENT_BULK_OPERATIONS = [
  'PUBLISH',
  'UNPUBLISH',
  'ARCHIVE',
  'RECATEGORISE',
] as const;
export type GarmentBulkOperation = (typeof GARMENT_BULK_OPERATIONS)[number];

/** `POST /admin/garments/bulk` (ADMIN) — A-12, D-16. Returns a per-item result, never all-or-nothing. */
export interface BulkGarmentRequest {
  operation: GarmentBulkOperation;
  garmentIds: Uuid[];
  /** Required when `operation === 'RECATEGORISE'`. */
  categoryId?: Uuid;
}

/** 207 when some items fail (`BULK_OPERATION_PARTIAL_FAILURE`); 200 when every item succeeded. */
export type BulkGarmentResponse = BulkOperationResult;

/**
 * `POST /admin/garments/bulk/estimate` (ADMIN) — the cost estimate shown *before* confirming a
 * bulk test-render selection (A-12). It spends nothing.
 */
export interface BulkEstimateRequest {
  garmentIds: Uuid[];
}

export interface BulkEstimateResponse {
  /** Garments that would actually be sent upstream, after skipping cached and already-approved ones. */
  billableCount: number;
  cachedCount: number;
  skippedCount: number;
  totalRequested: number;
  /** Remaining budget for the period, so the UI can warn before the admin commits (A-29). */
  budgetRemaining: number;
  wouldExceedBudget: boolean;
}

/** `GET /admin/catalog-health` (ADMIN) — A-15. */
export interface CatalogHealthResponse {
  missingTestRender: CatalogHealthItem[];
  lowQualityScore: CatalogHealthItem[];
  elevatedFailureRate: CatalogHealthItem[];
  zeroTryOnsIn30Days: CatalogHealthItem[];
}

export interface CatalogHealthItem {
  garmentId: Uuid;
  sku: string;
  title: string;
  categoryName: string;
  publishState: PublishState;
  testRenderState: TestRenderState;
  qualityScore: number | null;
  tryOnCount: number;
  failureCount: number;
  lastTriedAt: IsoDateTime | null;
  thumbnailUrl: string | null;
}
