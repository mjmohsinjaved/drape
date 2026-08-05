import { Category } from '@api/modules/categories/entities/category.entity';
import { Garment } from '@api/modules/garments/entities/garment.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { type ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { SHORTLIST_VERDICTS } from '@api/modules/shortlist/queries/shortlist.scope';

import type { SelectQueryBuilder } from 'typeorm';

/**
 * **The public share projection — PRD C-33, ARCHITECTURE §4.21, §5.14, S-10.**
 *
 * > C-33: "They see only the renders on that shortlist … They cannot see her photo,
 * > her other renders, or her contact details."
 *
 * This file is the only place a share view is allowed to build a query, and it is
 * written so that the three exclusions are **structural** rather than remembered:
 *
 * 1. **Her photo.** `person_photos` is not imported here, is not joined here, and no
 *    column of it appears in the projection. There is no expression in this file that
 *    could reach one — not by adding a filter, not by asking for one more column. The
 *    `person-photos` module is likewise absent from `ShareModule`'s imports, so the
 *    table has no repository in this module's injector at all.
 * 2. **Her other renders.** The render join is constrained three ways at once:
 *    `render.id = item.latestResultId` (only the render the shortlist row names),
 *    `render.userId = item.userId` (only a render belonging to the same account), and
 *    `render.isTestRender = false`. A render she has not put on this shortlist has no
 *    join condition that admits it.
 * 3. **Her contact details.** `users` is not joined. Her name, email and phone number
 *    live one join away and that join is not here — so the recipient view cannot
 *    render them however the mapper is later changed.
 *
 * **Only the thumbnail key is selected, never `storageKey`.** A `renders/**` key
 * requires a `sub`-scoped signed URL (§3.4), and a recipient has no session for a
 * `sub` to match — so a full-render URL could not be issued to them even in principle.
 * `thumbnails/render/**` is a public object class, which is exactly the right shape
 * for a page anyone with the link may open. The full-resolution render never becomes
 * addressable to a recipient at all.
 *
 * The projection is `getRawMany` over an explicit `select`, not entity hydration. That
 * is deliberate: a hydrated `ShortlistItem` carries `note` and a hydrated `TryOnResult`
 * carries `storageKey` and `personPhotoId`, and "the mapper doesn't read them" is a
 * weaker guarantee than "the query never loaded them".
 */

/** The alias every share query uses for `shortlist_items`. */
export const SHARED_ITEM_ALIAS = 'item';
/** The alias every share query uses for the joined `garments` row. */
export const SHARED_GARMENT_ALIAS = 'garment';
/** The alias every share query uses for the joined `categories` row. */
export const SHARED_CATEGORY_ALIAS = 'category';
/** The alias every share query uses for the joined `tryon_results` row. */
export const SHARED_RENDER_ALIAS = 'render';

/**
 * The complete set of columns a recipient may ever be shown.
 *
 * §4.21: "returns only `{ garment title, category, price if public, render url }` per
 * item". The extra fields here are the item id (so a vote can name what it is about),
 * the garment id (same), the rank (so the order she chose survives) and the currency
 * (a price without one is a number).
 *
 * `getRawMany` returns `decimal` as a string, hence `garmentPrice: string | null`.
 */
export interface SharedShortlistRow {
  itemId: string;
  rank: number | null;
  garmentId: string;
  garmentTitle: string;
  garmentSlug: string;
  garmentPrice: string | null;
  garmentCurrency: string;
  categoryName: string | null;
  renderThumbnailKey: string | null;
}

/**
 * Fragments that must never appear in a share query.
 *
 * Asserted by `public-share.scope.spec.ts` against everything the query builder was
 * asked to do — SQL fragments, selected columns, join conditions and the names of the
 * entity classes passed as join targets. A future edit that reaches for a photo, a
 * full render or the owner's account row fails the suite rather than shipping.
 */
export const FORBIDDEN_SHARE_FRAGMENTS: readonly string[] = [
  'person_photos',
  'personPhoto',
  'PersonPhoto',
  'storageKey',
  'contactEmail',
  'contactPhone',
  'passwordHash',
  'User',
  'users',
];

/**
 * The only way this module builds a share query.
 *
 * Scoped to one owner, to the two shortlist verdicts (§4.20 — a `NOT_FOR_ME` is a
 * piece she has said no to, and it never appears on a share page), and ordered by the
 * rank she chose.
 *
 * There is no snapshot table: §4.21 resolves the owner's **live** shortlist, so a
 * piece she removes disappears from every link that showed it. Revoking the link is
 * the control, and it is immediate.
 */
export function publicShareScope(
  qb: SelectQueryBuilder<ShortlistItem>,
  ownerId: string,
): SelectQueryBuilder<ShortlistItem> {
  return (
    qb
      .select(`${SHARED_ITEM_ALIAS}.id`, 'itemId')
      .addSelect(`${SHARED_ITEM_ALIAS}.rank`, 'rank')
      .addSelect(`${SHARED_GARMENT_ALIAS}.id`, 'garmentId')
      .addSelect(`${SHARED_GARMENT_ALIAS}.title`, 'garmentTitle')
      .addSelect(`${SHARED_GARMENT_ALIAS}.slug`, 'garmentSlug')
      .addSelect(`${SHARED_GARMENT_ALIAS}.price`, 'garmentPrice')
      .addSelect(`${SHARED_GARMENT_ALIAS}.currency`, 'garmentCurrency')
      .addSelect(`${SHARED_CATEGORY_ALIAS}.name`, 'categoryName')
      // The thumbnail, never `render.storageKey`. See the header comment.
      .addSelect(`${SHARED_RENDER_ALIAS}.thumbnailKey`, 'renderThumbnailKey')
      .innerJoin(
        Garment,
        SHARED_GARMENT_ALIAS,
        `${SHARED_GARMENT_ALIAS}.id = ${SHARED_ITEM_ALIAS}.garmentId` +
          ` AND ${SHARED_GARMENT_ALIAS}.deletedAt IS NULL`,
      )
      .leftJoin(
        Category,
        SHARED_CATEGORY_ALIAS,
        `${SHARED_CATEGORY_ALIAS}.id = ${SHARED_GARMENT_ALIAS}.categoryId`,
      )
      .leftJoin(
        TryOnResult,
        SHARED_RENDER_ALIAS,
        `${SHARED_RENDER_ALIAS}.id = ${SHARED_ITEM_ALIAS}.latestResultId` +
          ` AND ${SHARED_RENDER_ALIAS}.userId = ${SHARED_ITEM_ALIAS}.userId` +
          ` AND ${SHARED_RENDER_ALIAS}.isTestRender = false` +
          ` AND ${SHARED_RENDER_ALIAS}.deletedAt IS NULL`,
      )
      .where(`${SHARED_ITEM_ALIAS}.userId = :shareOwnerId`, { shareOwnerId: ownerId })
      .andWhere(`${SHARED_ITEM_ALIAS}.deletedAt IS NULL`)
      .andWhere(`${SHARED_ITEM_ALIAS}.verdict IN (:...shareVerdicts)`, {
        shareVerdicts: [...SHORTLIST_VERDICTS],
      })
      .orderBy(`${SHARED_ITEM_ALIAS}.rank`, 'ASC')
      .addOrderBy(`${SHARED_ITEM_ALIAS}.createdAt`, 'ASC')
  );
}
