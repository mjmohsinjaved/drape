import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { type EnquiryItem } from '../entities/enquiry-item.entity';

import type { SelectQueryBuilder } from 'typeorm';

/**
 * **The only path from an admin to a render — PRD S-10, ARCHITECTURE §4.24, §5.15.**
 *
 * > S-10: "Admins cannot view consumer photos. They see renders only where a consumer
 * > has submitted an enquiry."
 * >
 * > §4.24: "**This table is the sole basis on which an admin may view a render.** The
 * > admin renders query joins `enquiry_items → tryon_results`; there is no other path
 * > from an admin route to a `renders/**` signed URL, and an E-7 test asserts it."
 *
 * This is that query, and it is written so the sentence above is true by construction:
 *
 * - it **starts** from `enquiry_items`, so a render with no row here is unreachable;
 * - it is scoped to one `enquiryId`, so an admin looking at one enquiry cannot see
 *   another's renders, let alone another consumer's history;
 * - the render join is `render.id = item.resultId`, so the item names the render and
 *   nothing else can;
 * - `person_photos` is not joined, not selected and not imported. The **photograph the
 *   render was made from stays unreachable from every admin route in the product** —
 *   `AdminEnquiriesService` holds no repository for that table, and neither does this
 *   module.
 *
 * Only two columns come back: the render key and its thumbnail. `personPhotoId` is not
 * selected even though it sits on the same row, because a projection that carries it is
 * one careless mapper away from being an admin-visible link to a consumer's photograph.
 */

/** The alias the admin render query uses for `enquiry_items`. */
export const ADMIN_ENQUIRY_ITEM_ALIAS = 'item';
/** The alias the admin render query uses for the joined `tryon_results` row. */
export const ADMIN_ENQUIRY_RENDER_ALIAS = 'render';

/** The complete set of columns an admin render lookup returns. */
export interface AdminRenderRow {
  itemId: string;
  storageKey: string | null;
  thumbnailKey: string | null;
}

/**
 * Fragments that must never appear in the admin render query.
 *
 * Asserted by the spec beside this file against everything the builder was asked to
 * do. A future edit that reaches for the source photograph fails the suite (E-7).
 */
export const FORBIDDEN_ADMIN_RENDER_FRAGMENTS: readonly string[] = [
  'person_photos',
  'personPhoto',
  'PersonPhoto',
  'personPhotoId',
  'personPhotoLabelSnapshot',
];

/**
 * The renders one enquiry entitles an admin to see.
 *
 * `resultId` is `SET NULL` (§4.24), so a render the consumer has since deleted (C-31)
 * simply yields no row — the enquiry still reads, from its snapshot columns, with no
 * image beside the piece. That is the correct outcome: her deletion is permanent, and
 * an enquiry is not a second copy of her history.
 */
export function adminEnquiryRendersScope(
  qb: SelectQueryBuilder<EnquiryItem>,
  enquiryId: string,
): SelectQueryBuilder<EnquiryItem> {
  return qb
    .select(`${ADMIN_ENQUIRY_ITEM_ALIAS}.id`, 'itemId')
    .addSelect(`${ADMIN_ENQUIRY_RENDER_ALIAS}.storageKey`, 'storageKey')
    .addSelect(`${ADMIN_ENQUIRY_RENDER_ALIAS}.thumbnailKey`, 'thumbnailKey')
    .innerJoin(
      TryOnResult,
      ADMIN_ENQUIRY_RENDER_ALIAS,
      `${ADMIN_ENQUIRY_RENDER_ALIAS}.id = ${ADMIN_ENQUIRY_ITEM_ALIAS}.resultId` +
        ` AND ${ADMIN_ENQUIRY_RENDER_ALIAS}.deletedAt IS NULL`,
    )
    .where(`${ADMIN_ENQUIRY_ITEM_ALIAS}.enquiryId = :enquiryId`, { enquiryId })
    .andWhere(`${ADMIN_ENQUIRY_ITEM_ALIAS}.deletedAt IS NULL`);
}

/** The same query, typed straight to its rows. */
export async function loadAdminRenders(
  qb: SelectQueryBuilder<EnquiryItem>,
  enquiryId: string,
): Promise<AdminRenderRow[]> {
  return adminEnquiryRendersScope(qb, enquiryId).getRawMany<AdminRenderRow>();
}
