/**
 * ARCHITECTURE.md §5.13 `shortlist` and §4.20.
 *
 * The shortlist shows `LOVE_IT` and `MAYBE` ordered by `rank`. `NOT_FOR_ME` rows are retained for
 * A-38 rejection analytics but never appear here, never count toward the budget total, and are
 * excluded from enquiries.
 */

import { type IsoDateTime, type SignedFileUrl, type Uuid } from './common';
import { type BudgetBand, type Verdict } from './enums';

/** One row of `GET /shortlist` (CONSUMER), in rank order (C-32). */
export interface ShortlistItem {
  id: Uuid;
  garmentId: Uuid;
  garmentTitle: string;
  garmentSku: string;
  categoryName: string;
  price: number | null;
  currency: string;
  /** Only `LOVE_IT` or `MAYBE` ever appears on this screen. */
  verdict: Exclude<Verdict, 'NOT_FOR_ME'>;
  rank: number | null;
  note: string | null;
  /** The render shown beside the item (§4.20 `latestResultId`). Null when she has none yet. */
  latestResultId: Uuid | null;
  latestResultThumbnail: SignedFileUrl | null;
  /** False when the garment has since been unpublished, archived or removed (C-29). */
  garmentAvailable: boolean;
  verdictAt: IsoDateTime;
}

/** `GET /shortlist` (CONSUMER) — the list plus the running total against her budget band (C-32). */
export interface ShortlistResponse {
  items: ShortlistItem[];
  total: ShortlistTotal;
}

export interface ShortlistTotal {
  /** Sum of item prices. Null when `catalog.showPricesPublicly` is off (A-30). */
  amount: number | null;
  currency: string;
  itemCount: number;
  /** Her band from `consumer_profiles`, or null when she has not set one. */
  budgetBand: BudgetBand | null;
  /** True when the running total has passed the top of her band — a nudge, never a block. */
  overBudget: boolean;
}

/** `POST /shortlist` (CONSUMER) — equivalent to a `LOVE_IT` verdict on the garment. */
export interface AddToShortlistRequest {
  garmentId: Uuid;
  note?: string | null;
}

/** `PATCH /shortlist/:itemId` (CONSUMER) — update the note or the verdict. */
export interface UpdateShortlistItemRequest {
  note?: string | null;
  /** Setting `NOT_FOR_ME` removes the item from the shortlist without deleting the row (§4.20). */
  verdict?: Verdict;
}

/**
 * `POST /shortlist/reorder` (CONSUMER) — persists a drag-to-rank order (C-32).
 *
 * The client applies the new order optimistically (`useShortlistDraftStore`) and rolls it back on
 * failure (D-18).
 */
export interface ReorderShortlistRequest {
  /** Every shortlist item id, in the new rank order. */
  orderedIds: Uuid[];
}

export interface ReorderShortlistResponse {
  orderedIds: Uuid[];
}

/** `DELETE /shortlist/:itemId` (CONSUMER). */
export interface RemoveShortlistItemResponse {
  removedItemId: Uuid;
  itemCount: number;
}
