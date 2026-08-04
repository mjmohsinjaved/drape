/**
 * ARCHITECTURE.md §5.5 `categories`.
 *
 * A category tree is at most two levels deep (A-5): a category whose `parentId` is set may not
 * itself be a parent, enforced server-side as `CATEGORY_DEPTH_EXCEEDED`.
 */

import type { IsoDateTime, Uuid } from './common';

/** A node of the PUBLIC tree from `GET /categories` — published, non-archived, in `position` order (A-6). */
export interface CategoryNode {
  id: Uuid;
  name: string;
  nameUr: string | null;
  slug: string;
  parentId: Uuid | null;
  /** Signed URL for the cover image (§3.4), or null. The storage key never leaves the API. */
  coverImageUrl: string | null;
  position: number;
  /** Populated for a root node; always `[]` on a child, because the tree is one level deep. */
  children: CategoryNode[];
}

/** A node of the ADMIN tree from `GET /admin/categories` — includes archived, with garment counts. */
export interface AdminCategoryNode extends Omit<CategoryNode, 'children'> {
  archived: boolean;
  archivedAt: IsoDateTime | null;
  /** §4.12 denormalised counter; the A-7 delete guard reads it. */
  publishedGarmentCount: number;
  /** Every garment in the category, whatever its publish state. */
  totalGarmentCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  children: AdminCategoryNode[];
}

export interface AdminCategoryTreeQuery {
  includeArchived?: boolean;
}

/** `POST /admin/categories` (ADMIN) — A-4, A-5. */
export interface CreateCategoryRequest {
  name: string;
  nameUr?: string | null;
  /** Omit or `null` for a root category. Setting it to a child's id is `CATEGORY_DEPTH_EXCEEDED`. */
  parentId?: Uuid | null;
  slug?: string;
  position?: number;
}

/** `PATCH /admin/categories/:categoryId` (ADMIN) — rename, re-parent, set cover image. */
export interface UpdateCategoryRequest {
  name?: string;
  nameUr?: string | null;
  parentId?: Uuid | null;
  slug?: string;
  /** The upload ticket for a freshly uploaded cover, or `null` to clear the cover. */
  coverImageTicket?: string | null;
}

/** `POST /admin/categories/reorder` (ADMIN) — persists a new sort order for one sibling set (A-4). */
export interface ReorderCategoriesRequest {
  /** `null` reorders the root set. */
  parentId: Uuid | null;
  /** Every sibling id, in the order the admin dragged them into. */
  orderedIds: Uuid[];
}

export interface ReorderCategoriesResponse {
  parentId: Uuid | null;
  orderedIds: Uuid[];
}
