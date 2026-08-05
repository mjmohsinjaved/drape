import { AdminCategoryResponseDto, PublicCategoryResponseDto } from '../dto/category-response.dto';

import type { Category } from '../entities/category.entity';

/**
 * `categories` rows → response DTOs (§2.9: "controllers NEVER return raw entities").
 *
 * Two rules hold across every function here:
 *
 * - **`coverImageKey` stops at this boundary.** §3.4 forbids a storage key from
 *   crossing the network; the mapper mints a signed, expiring URL from it instead.
 * - **The public and admin shapes are built by different functions.** They are not
 *   one function with a flag, because a flag is a thing somebody can forget to pass
 *   and a missing `true` should not be able to publish `publishedGarmentCount` to a
 *   signed-out visitor.
 */

/** Mints a signed download URL for a storage key (§3.4). */
export type SignUrl = (storageKey: string) => string;

/** One node of the ordered sibling list, plus the children that belong under it. */
export interface CategoryNode {
  readonly category: Category;
  readonly children: readonly Category[];
}

function signedCover(category: Category, sign: SignUrl): string | null {
  return category.coverImageKey === null ? null : sign(category.coverImageKey);
}

/**
 * `GET /categories` — the public browse tree (A-6, C-1).
 *
 * The caller is responsible for having excluded archived nodes; this function does
 * not filter, so that "what the consumer can see" is decided in exactly one place —
 * `CategoriesService.findPublicTree()` — rather than half here and half there.
 */
export function toPublicCategory(node: CategoryNode, sign: SignUrl): PublicCategoryResponseDto {
  const dto = new PublicCategoryResponseDto();
  dto.id = node.category.id;
  dto.name = node.category.name;
  dto.nameUr = node.category.nameUr;
  dto.slug = node.category.slug;
  dto.coverImageUrl = signedCover(node.category, sign);
  dto.position = node.category.position;
  dto.children = node.children.map((child) =>
    toPublicCategory({ category: child, children: [] }, sign),
  );
  return dto;
}

/** `GET /admin/categories` and every admin mutation response (§5.5). */
export function toAdminCategory(node: CategoryNode, sign: SignUrl): AdminCategoryResponseDto {
  const childCount = node.children.reduce((total, child) => total + child.publishedGarmentCount, 0);
  const total = node.category.publishedGarmentCount + childCount;

  const dto = new AdminCategoryResponseDto();
  dto.id = node.category.id;
  dto.name = node.category.name;
  dto.nameUr = node.category.nameUr;
  dto.slug = node.category.slug;
  dto.parentId = node.category.parentId;
  dto.coverImageUrl = signedCover(node.category, sign);
  dto.position = node.category.position;
  dto.archived = node.category.archived;
  dto.archivedAt = node.category.archivedAt;
  dto.publishedGarmentCount = node.category.publishedGarmentCount;
  dto.publishedGarmentCountIncludingChildren = total;
  // A-7: "a category holding published garments cannot be deleted, only archived."
  // Surfaced on the row so the console can disable DELETE rather than offering an
  // action the API will refuse (D-5 permission-denied state).
  dto.deletable = total === 0;
  dto.createdAt = node.category.createdAt;
  dto.children = node.children.map((child) =>
    toAdminCategory({ category: child, children: [] }, sign),
  );
  return dto;
}
