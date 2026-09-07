

import type {
  EmbellishmentWeight,
  GarmentMode,
  IsoDateTime,
  PublishState,
  TestRenderState,
  Uuid,
} from '@repo/api-client';

export const QUALITY_CHECK_IDS = [
  'LONG_EDGE',
  'DOMINANT_GARMENT',
  'BACKGROUND_UNIFORMITY',
  'ASPECT_RATIO',
  'FORMAT',
] as const;

export type QualityCheckId = (typeof QUALITY_CHECK_IDS)[number];

export interface GarmentQualityCheck {
  check: string;
  passed: boolean;
  score: number;
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
  starRate: number | null;
  lastTriedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

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
  deposit?: number;
  description?: string;
  descriptionUr?: string;
  sizes?: string[];
  styleTags?: string[];
}

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

export interface DeleteGarmentBody {
  confirmTitle: string;
}

export interface QualityOverrideBody {
  reason: string;
}

export const MIN_OVERRIDE_REASON_LENGTH = 10;

export const GARMENT_BULK_ACTIONS = ['PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RECATEGORISE'] as const;
export type GarmentBulkAction = (typeof GARMENT_BULK_ACTIONS)[number];

export const MAX_BULK_GARMENTS = 100;

export const MAX_BULK_TEST_RENDERS = 50;

export interface BulkGarmentBody {
  action: GarmentBulkAction;
  garmentIds: Uuid[];
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

export interface GarmentImageWithQuality {
  image: AdminGarmentImage;
  quality: ImageQualityReport;
}

export interface CreateGarmentImageBody {
  key: string;
  isTryOnSource?: boolean;
  altText?: string;
  position?: number;
}

export interface UpdateGarmentImageBody {
  altText?: string;
  position?: number;
}

export interface ReorderGarmentImagesBody {
  imageIds: Uuid[];
}

export const MAX_GALLERY_IMAGES = 60;
export const MAX_GARMENT_IMAGES = 1;

export interface ReferenceModel {
  id: Uuid;
  label: string;
  thumbnailUrl: string | null;
  isDefault: boolean;
  position: number;
}

export interface TestRender {
  garmentId: Uuid;
  jobId: Uuid | null;
  resultId: Uuid | null;
  testRenderState: TestRenderState;
  sourceUrl: string | null;
  renderUrl: string | null;
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

export const MAX_REJECT_REASON_LENGTH = 255;

export interface BulkTestRenderBody {
  garmentIds: Uuid[];
  referenceModelId?: Uuid;
}

export interface BulkTestRenderQueued {
  batchId: Uuid;
}

export interface TestRenderEstimate {
  selected: number;
  generations: number;
  alreadyApproved: number;
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
  pending: number;
  items: TestRenderBatchItem[];
}

export const UPLOAD_PURPOSES = [
  'PERSON_PHOTO',
  'GARMENT_IMAGE',
  'CATEGORY_COVER',
  'BRAND_ASSET',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export interface CreateUploadTicketBody {
  purpose: UploadPurpose;
  contentType: string;
  byteSize: number;
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

export const ACCEPTED_IMAGE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

export const MAX_GARMENT_IMAGE_BYTES = 25 * 1024 * 1024;

export const MAX_CATEGORY_COVER_BYTES = 10 * 1024 * 1024;

export interface CatalogHealthGroup {
  items: AdminGarment[];
  total: number;
}

export interface CatalogHealth {
  missingTestRender: CatalogHealthGroup;
  lowQualityScore: CatalogHealthGroup;
  elevatedFailureRate: CatalogHealthGroup;
  zeroTryOnsIn30Days: CatalogHealthGroup;
}

export const DEFAULT_QUALITY_MIN_SCORE = 70;

export const ELEVATED_FAILURE_COUNT = 3;

export const STALE_TRY_ON_DAYS = 30;
