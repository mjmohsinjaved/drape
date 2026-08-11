

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

export interface ImageQualityReport {
  score: number;
  minScore: number;
  passed: boolean;
  verdict: QualityVerdict;
  needsBetterPhoto: boolean;
  label: string;
  checks: GarmentQualityCheck[];
}

/* ================================================================== *
 * Garments — §5.6
 * ================================================================== */

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
  flaggedForReview: boolean;
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

export interface UploadTicket {
  uploadUrl: string;
  ticket: string;
  key: string;
  fields: Record<string, string>;
  expiresAt: IsoDateTime;
  isDirect: boolean;
  purpose: UploadPurpose;
  maxBytes: number;
  contentType: string;
}

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
