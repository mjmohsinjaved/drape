/**
 * The try-on and history wire contract — ARCHITECTURE §5.11, §5.12, §5.16.
 *
 * Written against the real `TryOnJobResponseDto`, `ResultResponseDto` and
 * `QuotaSnapshotResponseDto`, which differ from the sketch in `@repo/api-client/types/tryon`
 * and `.../results`: the job response has no `stage`, no `garmentTitle` and no
 * `startedAt`/`finishedAt`, its consumer copy is `message` rather than `errorMessage`, and the
 * result carries flat `url` / `thumbnailUrl` strings rather than `SignedFileUrl` objects with a
 * separate compare image. The stage lives on the SSE stream only, which is why the wait screen
 * keeps it in the tray store rather than expecting it back from a poll.
 */

export type TryOnStage = 'QUEUED' | 'UPLOADING' | 'GENERATING' | 'FINISHING';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type Verdict = 'LOVE_IT' | 'MAYBE' | 'NOT_FOR_ME';
export type RejectReason = 'NECKLINE' | 'COLOR' | 'TOO_HEAVY' | 'SILHOUETTE' | 'PRICE';

/**
 * One try-on result — `ResultResponseDto`. Everything descriptive is a **snapshot**, so the row
 * still reads correctly after the garment is withdrawn (C-29) or the photo deleted (C-28).
 */
export interface TryOnResult {
  id: string;
  /** Null once the garment has been hard-deleted. */
  garmentId: string | null;
  garmentTitle: string;
  garmentCategory: string;
  garmentPrice: number | null;
  garmentCurrency: string;
  /** False when the garment is missing, archived or unpublished — hide "Try it on" (C-29). */
  garmentAvailable: boolean;
  personPhotoId: string | null;
  personPhotoLabel: string | null;
  /** Signed, expiring URL for the full render (§3.4). */
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  byteSize: number;
  marketingOptInAt: string | null;
  createdAt: string;
}

/** `POST /tryon` and `GET /tryon/jobs/:jobId` — the same shape for both (§5.11). */
export interface TryOnJob {
  jobId: string;
  status: JobStatus;
  origin: 'CONSUMER' | 'TEST_RENDER';
  cacheHit: boolean;
  garmentId: string | null;
  attempts: number;
  durationMs: number | null;
  /** An §2.4 `ErrorCode` on a failed job. Never rendered raw — mapped through i18n. */
  errorCode: string | null;
  /** The §8.3 consumer copy. We still translate by code rather than display it (§6.7). */
  message: string | null;
  result: TryOnResult | null;
  createdAt: string;
}

export interface StartTryOnBody {
  garmentId: string;
  /** Omitted to use her active photo (C-16). */
  personPhotoId?: string;
  /** Client-generated and stable for one intent, so a double tap cannot double-charge (§8.4). */
  idempotencyKey: string;
}

export interface TryOnJobQuery {
  page?: number;
  limit?: number;
  status?: JobStatus;
}

/* ------------------------------------------------------------------ SSE (§5.11) */

export interface StageEvent {
  stage: TryOnStage;
  jobId: string;
  elapsedMs: number;
}

export interface SucceededEvent {
  jobId: string;
  resultId: string;
  url: string;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  cacheHit: boolean;
}

export interface FailedEvent {
  jobId: string;
  errorCode: string;
  message: string;
}

export const TRYON_STREAM_EVENTS = ['stage', 'succeeded', 'failed', 'heartbeat'] as const;

/* ---------------------------------------------------------------- quota (§5.16) */

/** `GET /quota/me` — the persistent counter of C-5. Every number is derived, never stored. */
export interface MyQuota {
  period: string;
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
}
