import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { PublishState } from '@api/modules/garments/enums/publish-state.enum';
import type { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import type { BudgetBand } from '@api/modules/users/enums/budget-band.enum';

import {
  ShortlistBudgetDto,
  ShortlistItemResponseDto,
  ShortlistResponseDto,
} from '../dto/shortlist-response.dto';
import { budgetCeilingFor, isWithinBudget } from '../utils/budget-band.range';

import type { ShortlistItem } from '../entities/shortlist-item.entity';

/** Issues a signed, expiring, `sub`-scoped URL for a storage key (§3.4). */
export type SignRenderUrl = (storageKey: string) => string;

/** Everything the mapper needs that is not on the row itself. */
export interface ShortlistItemContext {
  /** The live garment. Absent only if it was hard-deleted between the two queries. */
  readonly garment: Garment | undefined;
  /** The render named by `latestResultId`, if it still exists and is hers. */
  readonly result: TryOnResult | undefined;
  readonly sign: SignRenderUrl;
}

/**
 * `shortlist_items` row → §5.13 response.
 *
 * **Only the thumbnail is signed.** The shortlist is a list screen, and §9.1 says a
 * list carries thumbnails; the full render costs a second signature and a second
 * range read for an image nobody is looking at yet. `latestResultId` is on the DTO so
 * opening a piece goes through `GET /results/:resultId`, which is where the C-20
 * caption and the compare toggle live.
 */
export function toShortlistItemResponse(
  item: ShortlistItem,
  context: ShortlistItemContext,
): ShortlistItemResponseDto {
  const dto = new ShortlistItemResponseDto();
  const { garment, result } = context;

  dto.id = item.id;
  dto.garmentId = item.garmentId;
  dto.garmentTitle = garment?.title ?? result?.garmentTitleSnapshot ?? '';
  dto.garmentCategory = result?.garmentCategorySnapshot ?? null;
  dto.price = garment?.price ?? result?.garmentPriceSnapshot ?? null;
  dto.currency = garment?.currency ?? result?.garmentCurrencySnapshot ?? 'PKR';
  dto.garmentAvailable = garment !== undefined && garment.publishState === PublishState.PUBLISHED;
  dto.verdict = item.verdict;
  dto.rejectReason = item.rejectReason;
  dto.rank = item.rank;
  dto.note = item.note;
  dto.latestResultId = item.latestResultId;
  dto.renderThumbnailUrl =
    result?.thumbnailKey === undefined || result.thumbnailKey === null
      ? null
      : context.sign(result.thumbnailKey);
  dto.verdictAt = item.verdictAt;

  return dto;
}

/**
 * The running total (C-32).
 *
 * Summed from the **DTOs**, not from the rows, so the total can only ever cover
 * pieces the caller was actually shown. A price that is null — a garment withdrawn
 * from the catalogue — contributes nothing rather than breaking the arithmetic.
 */
export function toShortlistResponse(
  items: readonly ShortlistItemResponseDto[],
  budgetBand: BudgetBand | null,
): ShortlistResponseDto {
  const total = items.reduce((sum, item) => sum + (item.price ?? 0), 0);

  const budget = new ShortlistBudgetDto();
  budget.total = total;
  budget.currency = items[0]?.currency ?? 'PKR';
  budget.budgetBand = budgetBand;
  budget.budgetCeiling = budgetCeilingFor(budgetBand);
  budget.withinBudget = isWithinBudget(total, budgetBand);
  budget.itemCount = items.length;

  const response = new ShortlistResponseDto();
  response.items = [...items];
  response.budget = budget;
  return response;
}
