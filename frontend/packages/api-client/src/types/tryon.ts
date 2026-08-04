/**
 * ARCHITECTURE.md §5.11 `tryon`, §4.17 and the SSE contract.
 *
 * `POST /tryon` runs the full §8.1 step-3 guard chain **before any spend**, then the cache lookup,
 * then upstream. A guard-chain rejection writes no `tryon_jobs` row at all, so a failure here has
 * no job to attach to. Failed jobs never consume quota or budget (PRD §8.3).
 */

import { type IsoDateTime, type PaginationQuery, type SignedFileUrl, type Uuid } from './common';
import { type JobOrigin, type JobStatus, type TryOnStage } from './enums';

/**
 * `POST /tryon` (CONSUMER).
 *
 * `idempotencyKey` is client-supplied (§8.1 step 1) and unique per `(userId, idempotencyKey)`.
 * Re-sending the same key while the job is `QUEUED`/`RUNNING` is `IDEMPOTENCY_IN_FLIGHT` with
 * `details.jobId`, so the client attaches to the existing SSE stream instead of retrying.
 */
export interface StartTryOnRequest {
  garmentId: Uuid;
  /** Omitted to use her active photo (C-16). */
  personPhotoId?: Uuid;
  idempotencyKey: string;
}

/**
 * `POST /tryon` response. `result` is present immediately on a cache hit — §8.1 step 4 short
 * circuits before any upstream call, and a cache hit writes **no** ledger row in either table
 * (C-22, §8.4).
 */
export interface StartTryOnResponse {
  jobId: Uuid;
  status: JobStatus;
  cacheHit: boolean;
  result?: TryOnJobResult;
}

/** The terminal payload of a successful job, shared by the response, the poll and the SSE event. */
export interface TryOnJobResult {
  resultId: Uuid;
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  cacheHit: boolean;
}

/** One row of `GET /tryon/jobs` (CONSUMER) — her recent and in-flight jobs, the C-19 results tray. */
export interface TryOnJob {
  id: Uuid;
  garmentId: Uuid | null;
  garmentTitle: string | null;
  garmentThumbnailUrl: string | null;
  personPhotoId: Uuid | null;
  status: JobStatus;
  /** Present while the job is running; absent once it reaches a terminal state. */
  stage: TryOnStage | null;
  origin: JobOrigin;
  cacheHit: boolean;
  /** An §2.4 `ErrorCode` value on a `FAILED` job. */
  errorCode: string | null;
  /** The §8.3 consumer copy for `errorCode`, already user-safe. */
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
  /** Defaults to the in-flight plus recently-finished window the tray needs. */
  activeOnly?: boolean;
}

/** `POST /tryon/jobs/:jobId/cancel` (CONSUMER). No quota is consumed either way. */
export interface CancelTryOnJobResponse {
  jobId: Uuid;
  status: 'CANCELLED';
}

/* --------------------------------------------------------------- SSE contract */

/**
 * `GET /tryon/jobs/:jobId/stream` (CONSUMER) — `text/event-stream`, **no envelope**.
 *
 * The stream closes after a terminal event. The client reconnects with `Last-Event-ID`; the server
 * replays the terminal state if the job already finished. A consumer may only stream her own job
 * (ownership check → masked `JOB_NOT_FOUND`).
 */
export const TRYON_STREAM_EVENTS = ['stage', 'succeeded', 'failed', 'heartbeat'] as const;
export type TryOnStreamEventName = (typeof TRYON_STREAM_EVENTS)[number];

/** `event: stage` — drives the staged microcopy of the ~7 s wait. At least one every 2 s. */
export interface TryOnStageEvent {
  stage: TryOnStage;
  jobId: Uuid;
  elapsedMs: number;
}

/** `event: succeeded` — terminal. */
export interface TryOnSucceededEvent {
  jobId: Uuid;
  resultId: Uuid;
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  cacheHit: boolean;
}

/** `event: failed` — terminal. `message` is the §8.3 consumer copy. */
export interface TryOnFailedEvent {
  jobId: Uuid;
  errorCode: string;
  message: string;
}

/** `event: heartbeat` — a comment frame every 15 s, to stop intermediaries closing the connection. */
export type TryOnHeartbeatEvent = Record<string, never>;

/** A discriminated union over the four §5.11 events, for a `switch` in the consumer hook. */
export type TryOnStreamEvent =
  | { event: 'stage'; data: TryOnStageEvent }
  | { event: 'succeeded'; data: TryOnSucceededEvent }
  | { event: 'failed'; data: TryOnFailedEvent }
  | { event: 'heartbeat'; data: TryOnHeartbeatEvent };

/* ------------------------------------------------------- admin: test renders */

/** One row of `GET /admin/reference-models` (ADMIN) — §4.15, A-11. */
export interface ReferenceModel {
  id: Uuid;
  label: string;
  thumbnail: SignedFileUrl | null;
  image: SignedFileUrl;
  isDefault: boolean;
  position: number;
  active: boolean;
}

/**
 * `POST /admin/tryon/test-render` (ADMIN) — one test render for a garment against a reference
 * model (A-11). **These are the only person images an admin ever sends upstream**; consumer photos
 * are never used for a test render (§4.15).
 */
export interface TestRenderRequest {
  garmentId: Uuid;
  /** Omitted to use the default reference model. */
  referenceModelId?: Uuid;
  idempotencyKey: string;
}

export interface TestRenderResponse {
  jobId: Uuid;
  status: JobStatus;
  cacheHit: boolean;
  result?: TryOnJobResult;
}

/**
 * `POST /admin/tryon/test-render/bulk` (ADMIN) — queued and processed at concurrency 1, so bulk
 * test renders never compete with a live generation (A-12, §8.2).
 */
export interface BulkTestRenderRequest {
  garmentIds: Uuid[];
  referenceModelId?: Uuid;
}

export interface BulkTestRenderResponse {
  batchId: Uuid;
  queuedCount: number;
  skippedCount: number;
}

/** `GET /admin/tryon/batches/:batchId` (ADMIN) — per-item progress and a summary (D-16). */
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

/**
 * `GET /admin/tryon/batches/:batchId/stream` (ADMIN) — **SSE** progress for the batch. Same
 * transport rules as the consumer stream; the payload is the batch summary plus the item that
 * just changed.
 */
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

/** `POST /admin/garments/:garmentId/test-render/approve` (ADMIN) — unblocks publishing (A-11). */
export interface ApproveTestRenderResponse {
  garmentId: Uuid;
  testRenderState: 'APPROVED';
  testRenderApprovedAt: IsoDateTime;
}

/** `POST /admin/garments/:garmentId/test-render/reject` (ADMIN). The garment stays unpublishable. */
export interface RejectTestRenderRequest {
  reason: string;
}

export interface RejectTestRenderResponse {
  garmentId: Uuid;
  testRenderState: 'REJECTED';
  reason: string;
}
