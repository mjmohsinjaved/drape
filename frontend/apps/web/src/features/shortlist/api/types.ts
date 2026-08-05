import type { RejectReason, Verdict } from '@/features/tryon/api/types';

/**
 * The shortlist contract — ARCHITECTURE §5.13, PRD C-32.
 *
 * Written against the real `ShortlistResponseDto` / `ShortlistItemResponseDto`, which differ from
 * the sketch in `@repo/api-client/types/shortlist`: the total is `budget` not `total` and carries
 * `budgetCeiling` and a **three-valued** `withinBudget` (null when she has stated no band — the
 * API refuses to invent a fact about her), the render thumbnail is `renderThumbnailUrl`, the
 * category is `garmentCategory`, reorder takes `itemIds` and answers with the whole list, and
 * `DELETE` answers `204`.
 */

export type BudgetBand =
  | 'UNDER_100K'
  | 'BAND_100K_250K'
  | 'BAND_250K_500K'
  | 'BAND_500K_1M'
  | 'ABOVE_1M';

/** One piece on the shortlist. Only `LOVE_IT` and `MAYBE` ever reach this screen (§4.20). */
export interface ShortlistItem {
  id: string;
  garmentId: string;
  garmentTitle: string;
  garmentCategory: string | null;
  price: number | null;
  currency: string;
  /** False once the piece is unpublished, archived or withdrawn (C-29). */
  garmentAvailable: boolean;
  verdict: Verdict;
  rejectReason: RejectReason | null;
  /** Her drag-to-rank position, 1 first (C-32). */
  rank: number | null;
  note: string | null;
  latestResultId: string | null;
  renderThumbnailUrl: string | null;
  verdictAt: string;
}

export interface ShortlistBudget {
  total: number;
  currency: string;
  budgetBand: BudgetBand | null;
  /** Ceiling of that band. Null for the open-ended top band, and when no band is set. */
  budgetCeiling: number | null;
  /** **Null when she has stated no band — not false.** */
  withinBudget: boolean | null;
  itemCount: number;
}

/** `GET /shortlist` (CONSUMER) — rank order, plus the running total (C-32). */
export interface ShortlistResponse {
  items: ShortlistItem[];
  budget: ShortlistBudget;
}

/** `POST /shortlist/reorder` — the **complete** list in the intended order; a partial set is refused. */
export interface ReorderShortlistBody {
  itemIds: string[];
}

/** `PATCH /shortlist/:itemId` — the note or the verdict. Rank moves through reorder only. */
export interface UpdateShortlistItemBody {
  verdict?: Verdict;
  rejectReason?: RejectReason | null;
  /** `null` clears the note. */
  note?: string | null;
}
