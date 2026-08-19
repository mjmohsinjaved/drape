import type { IsoDateTime, PaginationQuery, SignedFileUrl, Uuid } from './common';
import type { JobOrigin, JobStatus, TryOnStage } from './enums';

export interface StartTryOnRequest {
  garmentId: Uuid;
  personPhotoId?: Uuid;
  idempotencyKey: string;
}

export interface StartTryOnResponse {
  jobId: Uuid;
  status: JobStatus;
  cacheHit: boolean;
  result?: TryOnJobResult;
}

export interface TryOnJobResult {
  resultId: Uuid;
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  cacheHit: boolean;
}

export interface TryOnJob {
  id: Uuid;
  garmentId: Uuid | null;
  garmentTitle: string | null;
  garmentThumbnailUrl: string | null;
  personPhotoId: Uuid | null;
  status: JobStatus;
  stage: TryOnStage | null;
  origin: JobOrigin;
  cacheHit: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  startedAt: IsoDateTime | null;
  finishedAt: IsoDateTime | null;
  durationMs: number | null;
  createdAt: IsoDateTime;
  result: TryOnJobResult | null;
}

export interface TryOnJobListQuery extends PaginationQuery {
  status?: JobStatus;
  activeOnly?: boolean;
}

export interface CancelTryOnJobResponse {
  jobId: Uuid;
  status: 'CANCELLED';
}

export const TRYON_STREAM_EVENTS = ['stage', 'succeeded', 'failed', 'heartbeat'] as const;
export type TryOnStreamEventName = (typeof TRYON_STREAM_EVENTS)[number];

export interface TryOnStageEvent {
  stage: TryOnStage;
  jobId: Uuid;
  elapsedMs: number;
}

export interface TryOnSucceededEvent {
  jobId: Uuid;
  resultId: Uuid;
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  cacheHit: boolean;
}

export interface TryOnFailedEvent {
  jobId: Uuid;
  errorCode: string;
  message: string;
}

export type TryOnHeartbeatEvent = Record<string, never>;

export type TryOnStreamEvent =
  | { event: 'stage'; data: TryOnStageEvent }
  | { event: 'succeeded'; data: TryOnSucceededEvent }
  | { event: 'failed'; data: TryOnFailedEvent }
  | { event: 'heartbeat'; data: TryOnHeartbeatEvent };

export interface ReferenceModel {
  id: Uuid;
  label: string;
  thumbnail: SignedFileUrl | null;
  image: SignedFileUrl;
  isDefault: boolean;
  position: number;
  active: boolean;
}

export interface TestRenderRequest {
  garmentId: Uuid;
  referenceModelId?: Uuid;
  idempotencyKey: string;
}

export interface TestRenderResponse {
  jobId: Uuid;
  status: JobStatus;
  cacheHit: boolean;
  result?: TryOnJobResult;
}

export interface BulkTestRenderRequest {
  garmentIds: Uuid[];
  referenceModelId?: Uuid;
}

export interface BulkTestRenderResponse {
  batchId: Uuid;
  queuedCount: number;
  skippedCount: number;
}

export interface TestRenderBatch {
  batchId: Uuid;
  createdAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  items: TestRenderBatchItem[];
}

export interface TestRenderBatchItem {
  jobId: Uuid;
  garmentId: Uuid;
  garmentTitle: string;
  status: JobStatus;
  errorCode: string | null;
  errorMessage: string | null;
  resultId: Uuid | null;
  thumbnailUrl: string | null;
}

export const BATCH_STREAM_EVENTS = ['progress', 'completed', 'heartbeat'] as const;
export type BatchStreamEventName = (typeof BATCH_STREAM_EVENTS)[number];

export interface BatchProgressEvent {
  batchId: Uuid;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  item: TestRenderBatchItem;
}

export interface BatchCompletedEvent {
  batchId: Uuid;
  total: number;
  succeeded: number;
  failed: number;
}

export type BatchStreamEvent =
  | { event: 'progress'; data: BatchProgressEvent }
  | { event: 'completed'; data: BatchCompletedEvent }
  | { event: 'heartbeat'; data: Record<string, never> };

export interface ApproveTestRenderResponse {
  garmentId: Uuid;
  testRenderState: 'APPROVED';
  testRenderApprovedAt: IsoDateTime;
}

export interface RejectTestRenderRequest {
  reason: string;
}

export interface RejectTestRenderResponse {
  garmentId: Uuid;
  testRenderState: 'REJECTED';
  reason: string;
}

export const TRYON_DRIVERS = ['mock', 'http', 'gemini', 'openai'] as const;

export type TryOnDriver = (typeof TRYON_DRIVERS)[number];

export const OPENAI_IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;

export type OpenAiImageQuality = (typeof OPENAI_IMAGE_QUALITIES)[number];

export interface TryOnProviderOption {
  driver: TryOnDriver;
  label: string;
  description: string;
  configured: boolean;
  active: boolean;
  bootDefault: boolean;
  billable: boolean;
  selectable: boolean;
}

export interface TryOnProviderState {
  active: TryOnDriver;
  followingEnvironment: boolean;
  quality: OpenAiImageQuality;
  providers: TryOnProviderOption[];
}

export interface SelectTryOnProviderRequest {
  driver: TryOnDriver;
  quality?: OpenAiImageQuality;
}
