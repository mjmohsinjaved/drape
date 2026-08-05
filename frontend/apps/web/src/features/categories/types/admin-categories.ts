/**
 * The admin category tree, as `AdminCategoryResponseDto` actually serialises it (§5.5).
 *
 * Divergences from `@repo/api-client/types/categories.ts`, which `packages/**` owns and which is
 * therefore reported rather than edited:
 *
 * | `@repo/api-client` says | `apps/api` actually sends |
 * | --- | --- |
 * | `publishedGarmentCount` + `totalGarmentCount` | `publishedGarmentCount` + `publishedGarmentCountIncludingChildren` + `deletable` |
 * | `updatedAt` | not on the DTO |
 * | `UpdateCategoryRequest.coverImageTicket` | `coverImageKey` (the §3.5 key, or `null` to clear) |
 * | `ReorderCategoriesRequest.orderedIds` | `categoryIds` |
 * | reorder returns `{parentId, orderedIds}` | reorder returns the renumbered `AdminCategory[]` |
 *
 * `deletable` is the field that matters most: A-7 is decided by the API, and the console reads
 * the decision rather than re-deriving it from a count.
 */

import type { IsoDateTime, Uuid } from '@repo/api-client';

export interface AdminCategory {
  id: Uuid;
  name: string;
  nameUr: string | null;
  slug: string;
  /** One level only (A-5). A node with a `parentId` never has children. */
  parentId: Uuid | null;
  /** Signed, expiring URL (§3.4). The storage key never leaves the API. */
  coverImageUrl: string | null;
  position: number;
  archived: boolean;
  archivedAt: IsoDateTime | null;
  publishedGarmentCount: number;
  /** What the A-7 delete guard actually compares against — this node plus its children. */
  publishedGarmentCountIncludingChildren: number;
  /** Whether A-7 currently permits `DELETE`. The API decides; the console explains. */
  deletable: boolean;
  createdAt: IsoDateTime;
  children: AdminCategory[];
}

export interface CreateCategoryBody {
  name: string;
  nameUr?: string;
  slug?: string;
  /** Omit for a root category. A parent that already has a parent is `CATEGORY_DEPTH_EXCEEDED`. */
  parentId?: Uuid;
  coverImageKey?: string;
  position?: number;
}

/** `null` is a real edit — it promotes a sub-category, or clears a cover. */
export interface UpdateCategoryBody {
  name?: string;
  nameUr?: string | null;
  slug?: string;
  parentId?: Uuid | null;
  coverImageKey?: string | null;
  position?: number;
}

/** The complete sibling set in display order — the API refuses a partial list (A-4, A-6). */
export interface ReorderCategoriesBody {
  /** `null` reorders the root set. */
  parentId: Uuid | null;
  categoryIds: Uuid[];
}

/** `MAX_CATEGORY_NAME_LENGTH` from `CreateCategoryDto`. */
export const MAX_CATEGORY_NAME_LENGTH = 80;

/** The slug shape the API accepts, mirrored so the form can say so before the round trip. */
export const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A flat row plus its depth, which is what a tree renders and what keyboard reorder walks. */
export interface CategoryTreeRow {
  category: AdminCategory;
  depth: 0 | 1;
  /** The siblings this row can be reordered within, in current display order. */
  siblingIds: Uuid[];
  indexInSiblings: number;
}

/** Flattens the two-level tree into rows, parents first, each followed by its children. */
export function flattenCategoryTree(tree: readonly AdminCategory[]): CategoryTreeRow[] {
  const rootIds = tree.map((node) => node.id);
  const rows: CategoryTreeRow[] = [];

  tree.forEach((root, rootIndex) => {
    rows.push({
      category: root,
      depth: 0,
      siblingIds: rootIds,
      indexInSiblings: rootIndex,
    });

    const childIds = root.children.map((child) => child.id);
    root.children.forEach((child, childIndex) => {
      rows.push({
        category: child,
        depth: 1,
        siblingIds: childIds,
        indexInSiblings: childIndex,
      });
    });
  });

  return rows;
}

/** Every node in the tree, flat, for the pickers that need a category list rather than a tree. */
export function collectCategories(tree: readonly AdminCategory[]): AdminCategory[] {
  return tree.flatMap((node) => [node, ...node.children]);
}

/** Moving an item within an array without mutating it — the shared reorder primitive. */
export function moveWithin<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const clamped = Math.max(0, Math.min(to, next.length - 1));
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(clamped, 0, moved);
  return next;
}
