/**
 * ARCHITECTURE.md §5.12 `results` / history, and §4.18 — the critical table.
 *
 * **The history list renders exclusively from the snapshots.** It does not join `garments`; it
 * joins only to decide whether to show the "Try it on" action, and hides it behind a
 * "no longer available" label when the garment is missing, archived or unpublished (C-29).
 *
 * Verdicts are not stored on the result. They live on `shortlist_items` keyed by
 * `(userId, garmentId)` and the history DTO joins them in (§4.20) — hence `verdict` here is a
 * read-only projection, not a column.
 */

import type {
  IsoDateTime,
  PaginationQuery,
  SignedFileUrl,
  Uuid,
} from './common';
import type { RejectReason, Verdict } from './enums';

/** One row of `GET /results` (CONSUMER) — history, newest first. **Thumbnails only** (C-24, §9.1). */
export interface ResultListItem {
  id: Uuid;
  /** Null once the garment has been hard-deleted; the snapshots below still read correctly (C-29). */
  garmentId: Uuid | null;
  garmentTitleSnapshot: string;
  garmentCategorySnapshot: string;
  garmentPriceSnapshot: number | null;
  garmentCurrencySnapshot: string;
  /** Null once the photo has been deleted; the label snapshot survives for C-30 grouping (C-28). */
  personPhotoId: Uuid | null;
  personPhotoLabelSnapshot: string | null;
  thumbnail: SignedFileUrl;
  width: number;
  height: number;
  /** Joined from `shortlist_items`; null when she has not left a verdict yet. */
  verdict: Verdict | null;
  rejectReason: RejectReason | null;
  /** False when the garment is missing, archived or unpublished — the UI hides "Try it on" (C-29). */
  garmentAvailable: boolean;
  createdAt: IsoDateTime;
}

/**
 * `GET /results/:resultId` (CONSUMER) — the full render with the compare image, caption and
 * verdict state. **Costs nothing** (C-26): re-opening a render never touches quota or budget.
 */
export interface ResultDetail extends ResultListItem {
  /** The unwatermarked render, signed for `STORAGE_URL_TTL_RENDER_SECONDS`. */
  image: SignedFileUrl;
  /** Her original photo, for the side-by-side compare. Null once the photo has been deleted. */
  compareImage: SignedFileUrl | null;
  byteSize: number;
  /** §9.3 per-render explicit opt-in for brand marketing use. */
  marketingOptInAt: IsoDateTime | null;
  note: string | null;
}

/** `GET /results` query (C-25). */
export interface HistoryFilters extends PaginationQuery {
  verdict?: Verdict;
  categoryId?: Uuid;
  personPhotoId?: Uuid;
  /** Free text over the garment title snapshot. */
  search?: string;
}

/** `GET /results/groups/by-photo` (CONSUMER) — history grouped by its source photo (C-30). */
export interface ResultsByPhotoGroup {
  /** Null for the group whose photo has been deleted; `photoLabel` still identifies it (C-28). */
  personPhotoId: Uuid | null;
  photoLabel: string | null;
  /** Null when the photo is gone — the group header falls back to the label. */
  photoThumbnail: SignedFileUrl | null;
  resultCount: number;
  latestAt: IsoDateTime;
  results: ResultListItem[];
}

export interface ResultsByPhotoResponse {
  groups: ResultsByPhotoGroup[];
}

/**
 * `DELETE /results/:resultId` (CONSUMER) — C-31. Soft-deletes the row, **hard-deletes the file and
 * thumbnail immediately**, and writes a `deletion_log` row. The confirmation copy says the
 * deletion is permanent, and it is.
 */
export interface DeleteResultResponse {
  deletedResultId: Uuid;
}

/** `GET /results/:resultId/download` (CONSUMER) — watermarked PNG (C-23). */
export interface ResultDownloadResponse {
  download: SignedFileUrl;
  filename: string;
}

/** `POST /results/download` (CONSUMER) — a watermarked zip of a selected set (C-23, §7.5). */
export interface BulkResultDownloadRequest {
  resultIds: Uuid[];
}

export interface BulkResultDownloadResponse {
  download: SignedFileUrl;
  filename: string;
  includedCount: number;
  byteSize: number;
}

/** `POST /results/:resultId/marketing-opt-in` (CONSUMER) — explicit and per render (§9.3). */
export interface MarketingOptInRequest {
  /** `false` withdraws a previously granted opt-in. */
  optIn: boolean;
}

export interface MarketingOptInResponse {
  resultId: Uuid;
  marketingOptInAt: IsoDateTime | null;
}

/**
 * `POST /results/:resultId/verdict` (CONSUMER) — C-20, C-21.
 *
 * Upserts the one `shortlist_items` row for `(userId, garmentId)`. A `NOT_FOR_ME` verdict is
 * retained for A-38 analytics but never appears on the shortlist. Invalidate the narrowest keys:
 * `results.detail(id)`, `results.lists()` and `shortlist.list()` — never `results.all` (§6.4).
 */
export interface RecordVerdictRequest {
  verdict: Verdict;
  /** Only meaningful with `NOT_FOR_ME` (C-21). */
  rejectReason?: RejectReason | null;
  note?: string | null;
}

export interface RecordVerdictResponse {
  resultId: Uuid;
  garmentId: Uuid;
  verdict: Verdict;
  rejectReason: RejectReason | null;
  /** Null when the verdict was `NOT_FOR_ME` and the item left the shortlist. */
  shortlistItemId: Uuid | null;
  shortlistSize: number;
}
