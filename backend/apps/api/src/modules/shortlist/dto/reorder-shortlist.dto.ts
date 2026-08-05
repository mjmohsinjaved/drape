import { ApiProperty } from '@nestjs/swagger';

import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

import { MAX_SHORTLIST_REORDER_BATCH } from '../constants/shortlist.constants';

/**
 * `POST /shortlist/reorder` — persist a drag-to-rank order (C-32, §5.13).
 *
 * The payload is the **complete shortlist in the order it should appear**, not a
 * sparse list of moves — the same contract `POST /admin/categories/reorder` uses, for
 * the same reason. Sending the whole set makes the write idempotent and the resulting
 * order unambiguous: ranks are renumbered `1…n` from this array inside one
 * transaction, so two devices reordering at once produce one of the two intended
 * orders rather than an interleaving of both. C-32 promises the shortlist "persists
 * across devices", and an interleaving is exactly how that promise breaks.
 *
 * `ShortlistService` refuses a partial set. Renumbering half a shortlist is how
 * duplicate ranks are created, and duplicate ranks are a list that reorders itself
 * between two page loads.
 */
export class ReorderShortlistDto {
  @ApiProperty({
    description:
      'Every shortlist item id — Love it and Maybe alike — in the intended order, ' +
      'best first. Rejections are not on the shortlist and must not appear here.',
    type: [String],
    format: 'uuid',
    maxItems: MAX_SHORTLIST_REORDER_BATCH,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SHORTLIST_REORDER_BATCH)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  itemIds: string[];
}
