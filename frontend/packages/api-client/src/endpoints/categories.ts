/**
 * `categories` — ARCHITECTURE.md §5.5.
 *
 * `GET /categories` is public and answers the browse tree; everything under `/admin/categories`
 * is `@Roles(ADMIN)` and answers the full tree including archived nodes and their A-7 counts.
 */

import { delNoContent, get, patch, post, segment, type EndpointOptions } from './http';

import type {
  AdminCategory,
  AdminCategoryQuery,
  CreateCategoryRequest,
  PublicCategory,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from '../types/categories';

export const categoryPaths = {
  /** `GET /categories` (PUBLIC) — the browse nav (C-14). */
  publicCategories: '/categories',

  categories: '/admin/categories',
  category: (categoryId: string): string => `/admin/categories/${segment(categoryId)}`,
  reorder: '/admin/categories/reorder',
  archive: (categoryId: string): string => `/admin/categories/${segment(categoryId)}/archive`,
  restore: (categoryId: string): string => `/admin/categories/${segment(categoryId)}/restore`,
} as const;

/** `GET /categories` (PUBLIC). Two levels at most (A-5); not paginated. */
export async function listPublicCategories(
  options?: EndpointOptions,
): Promise<PublicCategory[]> {
  return get<PublicCategory[]>(categoryPaths.publicCategories, options);
}

/** `GET /admin/categories` (ADMIN) — the full tree with garment counts. Not paginated. */
export async function listCategories(
  query: AdminCategoryQuery = {},
  options?: EndpointOptions,
): Promise<AdminCategory[]> {
  return get<AdminCategory[]>(categoryPaths.categories, options, query);
}

/** `POST /admin/categories` (ADMIN) — A-5, A-6. */
export async function createCategory(
  body: CreateCategoryRequest,
  options?: EndpointOptions,
): Promise<AdminCategory> {
  return post<AdminCategory, CreateCategoryRequest>(categoryPaths.categories, body, options);
}

/** `PATCH /admin/categories/:categoryId` (ADMIN). `null` promotes a node, or clears a cover. */
export async function updateCategory(
  categoryId: string,
  body: UpdateCategoryRequest,
  options?: EndpointOptions,
): Promise<AdminCategory> {
  return patch<AdminCategory, UpdateCategoryRequest>(
    categoryPaths.category(categoryId),
    body,
    options,
  );
}

/**
 * `POST /admin/categories/reorder` (ADMIN) — A-6.
 *
 * Answers the **renumbered tree**, not an echo of the request, so the console re-renders from the
 * API's own positions rather than from what it hoped it had sent.
 */
export async function reorderCategories(
  body: ReorderCategoriesRequest,
  options?: EndpointOptions,
): Promise<AdminCategory[]> {
  return post<AdminCategory[], ReorderCategoriesRequest>(categoryPaths.reorder, body, options);
}

/** `POST /admin/categories/:categoryId/archive` (ADMIN) — A-7. Hidden, not deleted. */
export async function archiveCategory(
  categoryId: string,
  options?: EndpointOptions,
): Promise<AdminCategory> {
  return post<AdminCategory>(categoryPaths.archive(categoryId), undefined, options);
}

/** `POST /admin/categories/:categoryId/restore` (ADMIN) — un-archive. */
export async function restoreCategory(
  categoryId: string,
  options?: EndpointOptions,
): Promise<AdminCategory> {
  return post<AdminCategory>(categoryPaths.restore(categoryId), undefined, options);
}

/**
 * `DELETE /admin/categories/:categoryId` (ADMIN) — **204, no body back**.
 *
 * Blocked while the category holds published pieces (A-7); read `deletable` off the row rather
 * than offering an action the API will refuse (D-5).
 */
export async function deleteCategory(
  categoryId: string,
  options?: EndpointOptions,
): Promise<void> {
  return delNoContent(categoryPaths.category(categoryId), options);
}
