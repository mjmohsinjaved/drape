/**
 * The admin catalog wire types, as the API actually serialises them.
 *
 * ## Why these are declared here and not imported from `@repo/api-client`
 *
 * `@repo/api-client/types/garments.ts`, `garment-images.ts` and `files.ts` were written from
 * ARCHITECTURE §5.6/§5.7/§5.20 before the modules were built, and several shapes drifted while
 * the backend was implemented. `packages/**` is owned by another workstream, so the drift is
 * reported rather than patched, and the console codes against what the API sends:
 *
 * | `@repo/api-client` says | `apps/api` actually sends | Source |
 * | --- | --- | --- |
 * | `AdminGarmentListItem.thumbnailUrl` | not on the DTO at all | `garment-response.dto.ts` |
 * | `AdminGarmentDetail.images` | a separate `GET …/images` call | `garment-images.controller.ts` |
 * | `qualityChecks: … \| null` | always an array; `score` required, `remediation: string \| null` | `garment-response.dto.ts` |
 * | `qualityOverriddenByName` | `qualityOverridden: boolean` + `qualityOverriddenBy: uuid` | idem |
 * | `approvedByName` | `approvedBy: uuid` | idem |
 * | `AdminGarmentListQuery.sort: 'newest' \| …` | `sortBy: 'createdAt' \| 'tryOnCount' \| 'starRate' \| …` | `garment-query.dto.ts` |
 * | `BulkGarmentRequest.operation` | `action` | `garment-bulk.dto.ts` |
 * | `BulkItemResult.{id,success}` | `{garmentId,succeeded}` | `garment-response.dto.ts` |
 * | `DeleteGarmentRequest.confirmation` | `confirmTitle` | `delete-garment.dto.ts` |
 * | `FinaliseGarmentImageRequest.ticket` | `key` | `garment-image-create.dto.ts` |
 * | `ReorderGarmentImagesRequest.orderedIds` | `imageIds` | idem |
 * | `GarmentImage.qualityScore/qualityChecks` | a sibling `quality` report object | `garment-image-response.dto.ts` |
 * | `CreateUploadTicketRequest.{filename,mimeType,targetId}` | `{contentType,byteSize,ownerId}` | `create-upload-ticket.dto.ts` |
 * | `UploadTicket.ticket` | `uploadUrl` + `key`; there is no bare ticket field | `upload-ticket-response.dto.ts` |
 * | `BulkEstimateRequest/Response` | lives on `/admin/tryon/test-render/bulk/estimate` with different fields | `test-render-response.dto.ts` |
 * | `CatalogHealthResponse` | **no `GET /admin/catalog-health` route exists** | `apps/api/src/modules` |
 *
 * Everything that *did* match — the enums, `Uuid`, `IsoDateTime`, `Paginated`, `ApiError` — is
 * imported from `@repo/api-client` rather than restated.
 */

import type {
  EmbellishmentWeight,
  GarmentMode,
  IsoDateTime,
  PublishState,
  TestRenderState,
  Uuid,
} from '@repo/api-client';

/* ================================================================== *
 * A-10 image quality
 * ================================================================== */

/** The closed A-10 check set — `garments/validators/image-quality.constants.ts`. */
export const QUALITY_CHECK_IDS = [
  'LONG_EDGE',
  'DOMINANT_GARMENT',
  'BACKGROUND_UNIFORMITY',
  'ASPECT_RATIO',
  'FORMAT',
] as const;

export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number];

/** One A-10 check outcome. `remediation` is server-authored, user-safe copy (§10.5, D-7). */
export interface GarmentQualityCheck {
  check: string;
  passed: boolean;
  /** This check's contribution to the 0–100 score. */
  score: number;
  /** Present only when the check failed. */
  remediation: string | null;
}

export const QUALITY_VERDICTS = ['READY', 'NEEDS_BETTER_PHOTO'] as const;
export type QualityVerdict = (typeof QUALITY_VERDICTS)[number];

/** `ImageQualityReportDto` — the verdict for a try-on source (§5.7). */
export interface ImageQualityReport {
  score: number;
  /** The pass mark this was judged against (`quality.minScore`, default 70). */
  minScore: number;
  passed: boolean;
  verdict: QualityVerdict;
  /** True when A-10 marks the garment "Needs a better photo". */
  needsBetterPhoto: boolean;
  /** A-10's own label, served by the API so the console cannot drift from it. */
  label: string;
  checks: GarmentQualityCheck[];
}

/* ================================================================== *
 * Garments — §5.6
 * ================================================================== */

/** `GarmentResponseDto`. One shape for the list rows and the detail screen. */
export interface AdminGarment {
  id: Uuid;
  sku: string;
  title: string;
  titleUr: string | null;
  slug: string;
  categoryId: Uuid;
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
  qualityScore: number | null;
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
   * Whether the A-11 and A-10 gates would currently pass. The console disables Publish from
   * this rather than offering an action the API will refuse (D-5).
   */
  publishable: boolean;
  tryOnCount: number;
  loveCount: number;
  maybeCount: number;
  rejectCount: number;
  enquiryCount: number;
  failureCount: number;
  /** Love share of all verdicts cast, 0–1. `null` before the first verdict (A-14). */
  starRate: number | null;
  lastTriedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `GARMENT_SORT_KEYS` — the allow-list the query builder accepts. */
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

/**
 * A-14 names three sorts. Each is a `sortBy` + `sortOrder` pair, so the table exposes the three
 * by name and the wire stays the API's own vocabulary.
 */
export const GARMENT_SORT_PRESETS = ['newest', 'mostTried', 'highestStarRate'] as const;
export type GarmentSortPreset = (typeof GARMENT_SORT_PRESETS)[number];

export interface AdminGarmentQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: Uuid;
  publishState?: PublishState;
  mode?: GarmentMode;
  flaggedForReview?: boolean;
  sortBy?: GarmentSortKey;
  sortOrder?: 'ASC' | 'DESC';
}

export interface CreateGarmentBody {
  sku: string;
  title: string;
  titleUr?: string;
  slug?: string;
  categoryId: Uuid;
  colors?: string[];
  fabric?: string;
  embellishmentWeight: EmbellishmentWeight;
  price: number;
  currency?: string;
  mode: GarmentMode;
  /** Required when `mode === 'RENTAL'`, refused otherwise (A-8, §4.13). */
  deposit?: number;
  description?: string;
  descriptionUr?: string;
  sizes?: string[];
  styleTags?: string[];
}

/** `null` clears a nullable field; an absent key leaves it unchanged. */
export interface UpdateGarmentBody {
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

/** D-17 — the API checks the typed title itself; the dialog is not the safeguard. */
export interface DeleteGarmentBody {
  confirmTitle: string;
}

/** A-10 — the reason is required and becomes the `GARMENT_QUALITY_OVERRIDDEN` audit row. */
export interface QualityOverrideBody {
  reason: string;
}

/** Minimum length the API enforces on an override reason, so the form can say so first. */
export const MIN_OVERRIDE_REASON_LENGTH = 10;

/* ================================================================== *
 * Bulk — A-12, D-16
 * ================================================================== */

export const GARMENT_BULK_ACTIONS = ['PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RECATEGORISE'] as const;
export type GarmentBulkAction = (typeof GARMENT_BULK_ACTIONS)[number];

/** `MAX_BULK_GARMENTS` — one bulk write covers at most this many rows. */
export const MAX_BULK_GARMENTS = 100;

/** `MAX_BULK_TEST_RENDERS` — a test-render batch is capped lower; every item spends budget. */
export const MAX_BULK_TEST_RENDERS = 50;

export interface BulkGarmentBody {
  action: GarmentBulkAction;
  garmentIds: Uuid[];
  /** Required when `action === 'RECATEGORISE'`. */
  categoryId?: Uuid;
}

export interface BulkGarmentItemResult {
  garmentId: Uuid;
  succeeded: boolean;
  errorCode: string | null;
  message: string | null;
}

export interface BulkGarmentResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkGarmentItemResult[];
}

/* ================================================================== *
 * Images — §5.7, A-9
 * ================================================================== */

/** `GarmentImageResponseDto`. No storage key ever reaches the client (§3.4). */
export interface AdminGarmentImage {
  id: Uuid;
  garmentId: Uuid;
  url: string;
  thumbnailUrl: string | null;
  isTryOnSource: boolean;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  position: number;
  altText: string | null;
  createdAt: IsoDateTime;
}

/**
 * What the try-on-source endpoints return. The image and the A-10 verdict travel together so an
 * admin learns in one round trip whether the piece can be published (A-10).
 */
export interface GarmentImageWithQuality {
  image: AdminGarmentImage;
  quality: ImageQualityReport;
}

/** `CreateGarmentImageDto` — step 3 of the §3.5 upload flow. */
export interface CreateGarmentImageBody {
  /** The key handed back by the ticket redemption. */
  key: string;
  isTryOnSource?: boolean;
  altText?: string;
  position?: number;
}

export interface UpdateGarmentImageBody {
  altText?: string;
  position?: number;
}

/** The whole ordering, never a delta — the API refuses a partial set. */
export interface ReorderGarmentImagesBody {
  imageIds: Uuid[];
}

/** `MAX_GALLERY_IMAGES`. */
export const MAX_GALLERY_IMAGES = 60;

/* ================================================================== *
 * Test render — A-11, A-12 (§5.11 admin rows)
 * ================================================================== */

export interface ReferenceModel {
  id: Uuid;
  label: string;
  thumbnailUrl: string | null;
  isDefault: boolean;
  position: number;
}

/** `TestRenderResponseDto` — the render beside the source, for approval. */
export interface TestRender {
  garmentId: Uuid;
  jobId: Uuid | null;
  resultId: Uuid | null;
  testRenderState: TestRenderState;
  sourceUrl: string | null;
  renderUrl: string | null;
  /** True once approved — this is what unblocks publishing (A-11). */
  publishable: boolean;
  errorCode: string | null;
}

export interface RunTestRenderBody {
  garmentId: Uuid;
  referenceModelId?: Uuid;
}

export interface RejectTestRenderBody {
  reason: string;
}

/** The API caps a reject reason at 255 characters. */
export const MAX_REJECT_REASON_LENGTH = 255;

export interface BulkTestRenderBody {
  garmentIds: Uuid[];
  referenceModelId?: Uuid;
}

export interface BulkTestRenderQueued {
  batchId: Uuid;
}

/** A-12 — shown and confirmed *before* the run. It spends nothing. */
export interface TestRenderEstimate {
  selected: number;
  /** Generations this run would actually spend. */
  generations: number;
  alreadyApproved: number;
  /** Remaining monthly platform budget before the run (A-29). */
  budgetRemaining: number;
  withinBudget: boolean;
}

export const BATCH_ITEM_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type BatchItemStatus = (typeof BATCH_ITEM_STATUSES)[number];

export interface TestRenderBatchItem {
  garmentId: Uuid;
  jobId: Uuid | null;
  status: BatchItemStatus | null;
  errorCode: string | null;
}

export interface TestRenderBatch {
  batchId: Uuid;
  total: number;
  succeeded: number;
  failed: number;
  /** Queued plus running. */
  pending: number;
  items: TestRenderBatchItem[];
}

/* ================================================================== *
 * Files — §3.5, §5.20
 * ================================================================== */

export const UPLOAD_PURPOSES = [
  'PERSON_PHOTO',
  'GARMENT_IMAGE',
  'CATEGORY_COVER',
  'BRAND_ASSET',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** The client declares what it is about to send. It never names a key (§3.3). */
export interface CreateUploadTicketBody {
  purpose: UploadPurpose;
  contentType: string;
  byteSize: number;
  /** The garment or category the object belongs to. Required for the two catalog purposes. */
  ownerId?: Uuid;
}

/** `UploadTicketResponseDto`. `uploadUrl` already carries the signed ticket. */
export interface UploadTicket {
  uploadUrl: string;
  key: string;
  fields: Record<string, string>;
  expiresAt: IsoDateTime;
  isDirect: boolean;
  purpose: UploadPurpose;
  maxBytes: number;
  contentType: string;
}

/** What `PUT /files/upload/:ticket` answers once the bytes have landed. */
export interface UploadResult {
  key: string;
  byteSize: number;
  contentType: string;
}

/** A-10: "accepted format — HEIC, WebP, PNG, JPEG", as `ALLOWED_UPLOAD_MIME_TYPES` spells them. */
export const ACCEPTED_IMAGE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/** `UPLOAD_PURPOSE_POLICIES.GARMENT_IMAGE.maxBytes` — refuse locally before spending bandwidth. */
export const MAX_GARMENT_IMAGE_BYTES = 25 * 1024 * 1024;

/** `UPLOAD_PURPOSE_POLICIES.CATEGORY_COVER.maxBytes`. */
export const MAX_CATEGORY_COVER_BYTES = 10 * 1024 * 1024;

/* ================================================================== *
 * A-15 catalog health
 * ================================================================== */

/**
 * ARCHITECTURE §5.6 lists `GET /admin/catalog-health`, but **no such route exists in `apps/api`**
 * — there is no `catalog-health` controller, service or DTO anywhere in the backend. The panel is
 * therefore composed in the console from four narrow `GET /admin/garments` reads, which is
 * honest about what it can see: every field A-15 asks about is already on `GarmentResponseDto`.
 *
 * When the route lands, `useCatalogHealth` collapses to a single query and this type is deleted.
 */
export interface CatalogHealthGroup {
  items: AdminGarment[];
  total: number;
}

export interface CatalogHealth {
  /** Published or draft pieces with no approved test render (A-11, A-15). */
  missingTestRender: CatalogHealthGroup;
  /** Below the A-10 pass mark, or flagged "Needs a better photo". */
  lowQualityScore: CatalogHealthGroup;
  /** Repeated upstream failures — `UPSTREAM_NO_GARMENT_DETECTED` and friends (§8.3). */
  elevatedFailureRate: CatalogHealthGroup;
  /** Published, but nobody has tried it on in 30 days. */
  zeroTryOnsIn30Days: CatalogHealthGroup;
}

/** The A-10 pass mark the API defaults to, used only to sort the health list client-side. */
export const DEFAULT_QUALITY_MIN_SCORE = 70;

/** A-15's threshold for "elevated failure rate". */
export const ELEVATED_FAILURE_COUNT = 3;

/** A-15's window for "zero try-ons". */
export const STALE_TRY_ON_DAYS = 30;
