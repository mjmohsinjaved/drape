/**
 * One typed function per route in ARCHITECTURE §5.5.
 *
 * Same arrangement as `features/catalog/api/endpoints.ts`: §6.4 wants these in
 * `packages/api-client/src/endpoints/`, that directory does not exist, and `packages/**` is
 * another workstream's. The rule the components care about still holds — no component calls
 * `apiClient`.
 */

import { apiClient, type Uuid } from '@repo/api-client';

import type {
  AdminCategory,
  CreateCategoryBody,
  ReorderCategoriesBody,
  UpdateCategoryBody,
} from '@/features/categories/types/admin-categories';

export const categoryPaths = {
  tree: '/admin/categories',
  category: (categoryId: Uuid): string => `/admin/categories/${categoryId}`,
  reorder: '/admin/categories/reorder',
  archive: (categoryId: Uuid): string => `/admin/categories/${categoryId}/archive`,
  restore: (categoryId: Uuid): string => `/admin/categories/${categoryId}/restore`,
  uploadTicket: '/files/upload-ticket',
} as const;

/** The full tree. Archived nodes are included by default — the admin tree is complete. */
export async function listAdminCategories(
  includeArchived: boolean,
  signal?: AbortSignal,
): Promise<AdminCategory[]> {
  const response = await apiClient.get<AdminCategory[]>(categoryPaths.tree, {
    params: { includeArchived },
    signal,
  });
  return response.data;
}

export async function createCategory(body: CreateCategoryBody): Promise<AdminCategory> {
  const response = await apiClient.post<AdminCategory>(categoryPaths.tree, body);
  return response.data;
}

export async function updateCategory(
  categoryId: Uuid,
  body: UpdateCategoryBody,
): Promise<AdminCategory> {
  const response = await apiClient.patch<AdminCategory>(categoryPaths.category(categoryId), body);
  return response.data;
}

/** Renumbers one sibling set 0…n-1 in a single transaction, and answers with the new order. */
export async function reorderCategories(body: ReorderCategoriesBody): Promise<AdminCategory[]> {
  const response = await apiClient.post<AdminCategory[]>(categoryPaths.reorder, body);
  return response.data;
}

/** A-7 — the only way out for a category that holds published pieces. */
export async function archiveCategory(categoryId: Uuid): Promise<AdminCategory> {
  const response = await apiClient.post<AdminCategory>(categoryPaths.archive(categoryId));
  return response.data;
}

export async function restoreCategory(categoryId: Uuid): Promise<AdminCategory> {
  const response = await apiClient.post<AdminCategory>(categoryPaths.restore(categoryId));
  return response.data;
}

/** 204. Refused with `CATEGORY_HAS_PUBLISHED_GARMENTS` while anything published sits under it. */
export async function deleteCategory(categoryId: Uuid): Promise<void> {
  await apiClient.delete<void>(categoryPaths.category(categoryId));
}
