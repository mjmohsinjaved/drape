import type { RejectReason, TryOnResult, Verdict } from '@/features/tryon/api/types';

/**
 * History and verdicts — ARCHITECTURE §5.12, §5.13, PRD C-24 … C-31.
 *
 * A history row **is** `ResultResponseDto`, so the type is shared with the try-on feature rather
 * than restated: the same object comes back from `POST /tryon`, from the job poll and from
 * `GET /results`, and one shape for one concept is what stops a client parsing it two ways.
 *
 * Two documented gaps against ARCHITECTURE §5.12, both handled in the feature rather than papered
 * over here:
 *
 * - The row carries **no `verdict`**. Verdicts live on `shortlist_items` and are joined in by the
 *   client from `GET /shortlist` (§4.20). `NOT_FOR_ME` never appears on that response, so a
 *   rejected piece reads as "no verdict yet" until the API projects it.
 * - `GET /results` accepts only `personPhotoId` and `search`. The `verdict` and `categoryId`
 *   filters §5.12 lists are applied over the fetched page instead.
 */

export type ResultListItem = TryOnResult;
export type { RejectReason, Verdict };

/** `GET /results/groups/by-photo` (CONSUMER) — C-30. */
export interface ResultGroup {
  personPhotoId: string | null;
  personPhotoLabel: string | null;
  count: number;
  items: ResultListItem[];
}

/** `GET /results` query, as `ResultQueryDto` actually accepts it. */
export interface ResultQuery {
  page?: number;
  limit?: number;
  personPhotoId?: string;
  search?: string;
}

/**
 * `POST /shortlist` — one payload for all three verdicts, because §4.20 makes them one row
 * keyed `(userId, garmentId)`. Posting twice for the same piece moves it rather than duplicating
 * it, and keeps the rank it already had.
 */
export interface RecordVerdictBody {
  garmentId: string;
  verdict: Verdict;
  /** Only meaningful beside `NOT_FOR_ME`; stored as null for anything else (C-21). */
  rejectReason?: RejectReason;
  note?: string;
  /** The render she was looking at when she decided, shown beside the shortlist item. */
  resultId?: string;
}
