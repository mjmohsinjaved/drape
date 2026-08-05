'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { isApiError, queryKeys, type ApiError, type Uuid } from '@repo/api-client';

import {
  archiveCategory,
  createCategory,
  deleteCategory,
  listAdminCategories,
  reorderCategories,
  restoreCategory,
  updateCategory,
} from '@/features/categories/api/endpoints';
import {
  moveWithin,
  type AdminCategory,
  type CreateCategoryBody,
  type UpdateCategoryBody,
} from '@/features/categories/types/admin-categories';

/**
 * The A-4 … A-7 taxonomy.
 *
 * The tree is a single cache entry under `categories.tree('admin')`, so every write here is an
 * optimistic edit of one array plus a rollback (D-18). Reordering in particular has to be
 * instant — dragging a category and waiting 200 ms to see it move makes the whole rail feel
 * broken — and it has to snap back honestly when the write is refused.
 */

const ADMIN_TREE_KEY = queryKeys.categories.tree('admin');

export function useAdminCategories(
  options: { includeArchived?: boolean; initialData?: AdminCategory[] } = {},
): UseQueryResult<AdminCategory[], ApiError> {
  const { includeArchived = true, initialData } = options;

  return useQuery<AdminCategory[], ApiError>({
    queryKey: [...ADMIN_TREE_KEY, { includeArchived }] as const,
    queryFn: ({ signal }) => listAdminCategories(includeArchived, signal),
    initialData,
  });
}

/** Every cached admin tree, whatever `includeArchived` it was fetched with. */
function invalidateTree(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ADMIN_TREE_KEY });
}

export function useCreateCategory(): UseMutationResult<
  AdminCategory,
  ApiError,
  CreateCategoryBody
> {
  const queryClient = useQueryClient();

  return useMutation<AdminCategory, ApiError, CreateCategoryBody>({
    mutationFn: createCategory,
    onSuccess: () => {
      invalidateTree(queryClient);
      // The public tree is what consumers browse (A-6).
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('public') });
    },
  });
}

export interface UpdateCategoryVariables {
  categoryId: Uuid;
  body: UpdateCategoryBody;
}

interface TreeSnapshot {
  entries: Array<[readonly unknown[], AdminCategory[]]>;
}

/** Applies a change to a node wherever it sits in the two-level tree. */
function patchNode(
  tree: readonly AdminCategory[],
  categoryId: Uuid,
  patch: Partial<AdminCategory>,
): AdminCategory[] {
  return tree.map((node) => {
    if (node.id === categoryId) return { ...node, ...patch };
    if (node.children.length === 0) return node;
    return {
      ...node,
      children: node.children.map((child) =>
        child.id === categoryId ? { ...child, ...patch } : child,
      ),
    };
  });
}

function snapshotTrees(queryClient: ReturnType<typeof useQueryClient>): TreeSnapshot {
  return {
    entries: queryClient
      .getQueriesData<AdminCategory[]>({ queryKey: ADMIN_TREE_KEY })
      .filter((entry): entry is [readonly unknown[], AdminCategory[]] => entry[1] !== undefined),
  };
}

function restoreTrees(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshot: TreeSnapshot | undefined,
): void {
  if (!snapshot) return;
  for (const [key, value] of snapshot.entries) queryClient.setQueryData(key, value);
}

/** D-18 — a rename lands as it is typed and rolls back with a reason if the API refuses it. */
export function useUpdateCategory(): UseMutationResult<
  AdminCategory,
  ApiError,
  UpdateCategoryVariables,
  TreeSnapshot
> {
  const queryClient = useQueryClient();

  return useMutation<AdminCategory, ApiError, UpdateCategoryVariables, TreeSnapshot>({
    mutationFn: ({ categoryId, body }) => updateCategory(categoryId, body),
    onMutate: async ({ categoryId, body }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_TREE_KEY });
      const snapshot = snapshotTrees(queryClient);

      // `parentId` is deliberately not applied optimistically: re-parenting moves a node between
      // sibling sets and renumbers both, which is a server decision, not a local splice.
      const { parentId: _parentId, coverImageKey: _coverImageKey, ...visible } = body;
      for (const [key, value] of snapshot.entries) {
        queryClient.setQueryData(key, patchNode(value, categoryId, visible));
      }
      return snapshot;
    },
    onError: (_error, _variables, snapshot) => {
      restoreTrees(queryClient, snapshot);
    },
    onSettled: () => {
      invalidateTree(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('public') });
    },
  });
}

export interface ReorderVariables {
  /** `null` reorders the root set. */
  parentId: Uuid | null;
  /** The complete sibling set, in the intended order. */
  categoryIds: Uuid[];
}

/** Reorders one sibling set inside a tree without disturbing anything else. */
function applyOrder(
  tree: readonly AdminCategory[],
  parentId: Uuid | null,
  categoryIds: readonly Uuid[],
): AdminCategory[] {
  const order = new Map(categoryIds.map((id, index) => [id, index]));

  if (parentId === null) {
    return [...tree]
      .sort((a, b) => (order.get(a.id) ?? a.position) - (order.get(b.id) ?? b.position))
      .map((node, index) => ({ ...node, position: index }));
  }

  return tree.map((node) => {
    if (node.id !== parentId) return node;
    return {
      ...node,
      children: [...node.children]
        .sort((a, b) => (order.get(a.id) ?? a.position) - (order.get(b.id) ?? b.position))
        .map((child, index) => ({ ...child, position: index })),
    };
  });
}

export function useReorderCategories(): UseMutationResult<
  AdminCategory[],
  ApiError,
  ReorderVariables,
  TreeSnapshot
> {
  const queryClient = useQueryClient();

  return useMutation<AdminCategory[], ApiError, ReorderVariables, TreeSnapshot>({
    mutationFn: ({ parentId, categoryIds }) => reorderCategories({ parentId, categoryIds }),
    onMutate: async ({ parentId, categoryIds }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_TREE_KEY });
      const snapshot = snapshotTrees(queryClient);

      for (const [key, value] of snapshot.entries) {
        queryClient.setQueryData(key, applyOrder(value, parentId, categoryIds));
      }
      return snapshot;
    },
    onError: (_error, _variables, snapshot) => {
      restoreTrees(queryClient, snapshot);
    },
    onSettled: () => {
      invalidateTree(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('public') });
    },
  });
}

export type CategoryArchiveAction = 'archive' | 'restore';

export interface ArchiveVariables {
  categoryId: Uuid;
  action: CategoryArchiveAction;
}

/** A-7 — archiving is the way out for a category that holds pieces. It is always reversible. */
export function useArchiveCategory(): UseMutationResult<
  AdminCategory,
  ApiError,
  ArchiveVariables,
  TreeSnapshot
> {
  const queryClient = useQueryClient();

  return useMutation<AdminCategory, ApiError, ArchiveVariables, TreeSnapshot>({
    mutationFn: ({ categoryId, action }) =>
      action === 'archive' ? archiveCategory(categoryId) : restoreCategory(categoryId),
    onMutate: async ({ categoryId, action }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_TREE_KEY });
      const snapshot = snapshotTrees(queryClient);

      for (const [key, value] of snapshot.entries) {
        queryClient.setQueryData(
          key,
          patchNode(value, categoryId, { archived: action === 'archive' }),
        );
      }
      return snapshot;
    },
    onError: (_error, _variables, snapshot) => {
      restoreTrees(queryClient, snapshot);
    },
    onSettled: () => {
      invalidateTree(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('public') });
    },
  });
}

/**
 * Delete. Refused with `CATEGORY_HAS_PUBLISHED_GARMENTS` while anything published sits under it
 * or under one of its sub-categories (A-7) — the console explains that and offers archiving
 * instead of repeating the refusal.
 *
 * Not optimistic. Removing a node from the tree and putting it back is a worse experience than
 * a moment's wait, and this is the one category action that cannot be undone.
 */
export function useDeleteCategory(): UseMutationResult<void, ApiError, Uuid> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, Uuid>({
    mutationFn: deleteCategory,
    onSuccess: () => {
      invalidateTree(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('public') });
      // A deleted category cannot hold garments, but the list's category filter reads the tree.
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
    },
  });
}

/** True when a failure is the A-7 guard, which gets an explanation rather than an error (D-7). */
export function isCategoryInUse(error: unknown): boolean {
  return isApiError(error) && error.errorCode === 'CATEGORY_HAS_PUBLISHED_GARMENTS';
}

export { moveWithin };
