import type { Category } from '@api/modules/categories/entities/category.entity';
import type { GarmentImage } from '@api/modules/garments/entities/garment-image.entity';
import type { Garment } from '@api/modules/garments/entities/garment.entity';
import { GarmentMode } from '@api/modules/garments/enums/garment-mode.enum';

import {
  PublicGarmentDetailDto,
  PublicGarmentImageDto,
  PublicGarmentSummaryDto,
} from '../dto/public-garment-response.dto';

/**
 * `garments` rows → the **public** catalog DTOs (C-1, C-17, C-18).
 *
 * Three rules hold here and are each covered by a test:
 *
 * 1. **Admin-only fields have no line in this file.** `sku`, `publishState`,
 *    `qualityScore`, `qualityChecks`, `testRenderState`, `testRenderId`,
 *    `flaggedForReview`, `failureCount`, `approvedBy` and every engagement counter
 *    are simply never read. `PublicGarmentSummaryDto` has nowhere to put them.
 * 2. **A-30 is applied here, once.** When `showPrices` is false, `price`, `currency`
 *    and `deposit` are `null` on every public response — grid, detail and new
 *    arrivals alike — because they are all built by these functions.
 * 3. **Storage keys stop at this boundary.** §3.4: a key never crosses the network;
 *    `sign` turns it into a signed, expiring URL, and is passed in rather than
 *    injected so this file stays a pure mapper.
 */

/** Mints a signed download URL for a storage key (§3.4). */
export type SignUrl = (storageKey: string) => string;

/** Everything the public projection needs beyond the garment row itself. */
export interface PublicGarmentContext {
  readonly category: Category | undefined;
  readonly images: readonly GarmentImage[];
  /** `catalog.showPricesPublicly` (A-30). */
  readonly showPrices: boolean;
  readonly sign: SignUrl;
}

export function toPublicImage(image: GarmentImage, sign: SignUrl): PublicGarmentImageDto {
  const dto = new PublicGarmentImageDto();
  dto.url = sign(image.storageKey);
  dto.thumbnailUrl = image.thumbnailKey === null ? null : sign(image.thumbnailKey);
  dto.altText = image.altText;
  dto.position = image.position;
  return dto;
}

/** Fills the fields the grid card and the detail page share. */
function fillSummary<T extends PublicGarmentSummaryDto>(
  dto: T,
  garment: Garment,
  context: PublicGarmentContext,
): T {
  dto.id = garment.id;
  dto.slug = garment.slug;
  dto.title = garment.title;
  dto.titleUr = garment.titleUr;
  dto.categoryId = garment.categoryId;
  dto.categoryName = context.category?.name ?? null;
  dto.categorySlug = context.category?.slug ?? null;
  dto.colors = garment.colors;
  dto.embellishmentWeight = garment.embellishmentWeight;
  dto.sizes = garment.sizes;
  dto.mode = garment.mode;

  // A-30. One conditional, covering all three money fields, in the one function every
  // public response passes through.
  dto.price = context.showPrices ? garment.price : null;
  dto.currency = context.showPrices ? garment.currency : null;
  dto.deposit = context.showPrices && garment.mode === GarmentMode.RENTAL ? garment.deposit : null;

  const first = [...context.images].sort((left, right) => left.position - right.position)[0];
  dto.primaryImage = first === undefined ? null : toPublicImage(first, context.sign);
  dto.publishedAt = garment.publishedAt;
  return dto;
}

/** `GET /catalog/garments` and `/catalog/new-arrivals` — the grid card (C-1, C-17). */
export function toPublicGarmentSummary(
  garment: Garment,
  context: PublicGarmentContext,
): PublicGarmentSummaryDto {
  return fillSummary(new PublicGarmentSummaryDto(), garment, context);
}

/** `GET /catalog/garments/:slugOrId` — gallery, price, fabric, sizes (C-18). */
export function toPublicGarmentDetail(
  garment: Garment,
  context: PublicGarmentContext,
): PublicGarmentDetailDto {
  const dto = fillSummary(new PublicGarmentDetailDto(), garment, context);
  dto.fabric = garment.fabric;
  dto.description = garment.description;
  dto.descriptionUr = garment.descriptionUr;
  dto.styleTags = garment.styleTags;
  dto.images = [...context.images]
    .sort((left, right) => left.position - right.position)
    .map((image) => toPublicImage(image, context.sign));
  return dto;
}
