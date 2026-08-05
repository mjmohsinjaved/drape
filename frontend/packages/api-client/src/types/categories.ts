/**
 * ARCHITECTURE.md §5.5 `categories`.
 *
 * A category tree is at most two levels deep (A-5): a category whose `parentId` is set may not
 * itself be a parent, enforced server-side as `CATEGORY_DEPTH_EXCEEDED`.
 *
 * Written against `modules/categories/dto/**`.
 */

import type { IsoDateTime, Uuid } from './common';

/**
 * `PublicCategoryResponseDto` — `GET /categories` (PUBLIC), the browse nav (C-14).
 *
 * Counts, archive state and the delete guard are all admin concerns and are absent here.
 */
export interface PublicCategory {
  id: Uuid;
  name: string;
  /** Urdu display name (C-41). */
  nameUr: string | null;
  slug: string;
  /** Signed, expiring cover-image URL (A-6, §3.4). The storage key never leaves the API. */
  coverImageUrl: string | null;
  /** Browse order (A-6), ascending. */
  position: number;
  /** One level only (A-5). Always empty on a sub-category. */
  children: PublicCategory[];
}

/**
 * `AdminCategoryResponseDto` — the whole `/admin/categories` surface (§5.5).
 *
 * There is no `updatedAt` and no `totalGarmentCount`. The count that matters is
 * `publishedGarmentCountIncludingChildren`, and `deletable` is the API's own A-7 decision: the
 * console reads the decision rather than re-deriving it from a count.
 */
export interface AdminCategory {
  id: Uuid;
  name: string;
  nameUr: string | null;
  slug: string;
  /** One level only (A-5). A node with a `parentId` never has children. */
  parentId: Uuid | null;
  coverImageUrl: string | null;
  position: number;
  /** A-7: an archived category is hidden, not deleted. */
  archived: boolean;
  archivedAt: IsoDateTime | null;
  /** Held directly by this category. */
  publishedGarmentCount: number;
  /** This node plus, for a top-level node, its sub-categories — what the delete guard compares. */
  publishedGarmentCountIncludingChildren: number;
  /** Whether A-7 currently permits `DELETE`. The API decides; the console explains. */
  deletable: boolean;
  createdAt: IsoDateTime;
  children: AdminCategory[];
}

/** `GET /admin/categories`. The admin tree is complete by default, archived rows included. */
export interface AdminCategoryQuery {
  includeArchived?: boolean;
}

/** `MAX_CATEGORY_NAME_LENGTH` from `CreateCategoryDto`. */
export const MAX_CATEGORY_NAME_LENGTH = 80;

/** The slug shape the API accepts, mirrored so a form can say so before the round trip. */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `POST /admin/categories` (ADMIN) — A-5, A-6.
 *
 * The cover is named by its **storage key** — the value `PUT /files/upload/:ticket` handed back —
 * not by a ticket. The key is never returned; a signed URL is.
 */
export interface CreateCategoryRequest {
  name: string;
  nameUr?: string;
  /** Derived from `name` when omitted, and de-duplicated with a numeric suffix if taken. */
  slug?: string;
  /** Omit for a root category. A parent that already has a parent is `CATEGORY_DEPTH_EXCEEDED`. */
  parentId?: Uuid;
  coverImageKey?: string;
  /** Appended to the end of its sibling set when omitted. */
  position?: number;
}

/** `PATCH /admin/categories/:categoryId`. `null` is a real edit — it promotes a node, or clears a cover. */
export interface UpdateCategoryRequest {
  name?: string;
  nameUr?: string | null;
  slug?: string;
  parentId?: Uuid | null;
  coverImageKey?: string | null;
  position?: number;
}

/** One reorder covers at most this many siblings. */
export const MAX_REORDER_BATCH = 200;

/**
 * `POST /admin/categories/reorder` (ADMIN) — A-6.
 *
 * The **complete** sibling set in display order; the API refuses a partial list. The field is
 * `categoryIds`, and the route answers the renumbered tree rather than an echo of the request.
 */
export interface ReorderCategoriesRequest {
  /** The parent whose children are being ordered. Omit or send `null` for the top-level set. */
  parentId?: Uuid | null;
  categoryIds: Uuid[];
}
