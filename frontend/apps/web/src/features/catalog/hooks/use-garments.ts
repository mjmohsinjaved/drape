'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { STALE_TIMES, queryKeys, type ApiError, type Paginated, type Uuid } from '@repo/api-client';

import {
  archiveGarment,
  bulkGarments,
  createGarment,
  deleteGarment,
  getGarment,
  listGarments,
  overrideGarmentQuality,
  publishGarment,
  unpublishGarment,
  updateGarment,
} from '@/features/catalog/api/endpoints';

import type {
  AdminGarment,
  AdminGarmentQuery,
  BulkGarmentBody,
  BulkGarmentResult,
  CreateGarmentBody,
  UpdateGarmentBody,
} from '@/features/catalog/types/admin-catalog';

/**
 * Server state for the admin catalog — ARCHITECTURE §6.4.
 *
 * Two rules run through every mutation here:
 *
 * - **Invalidate the narrowest key that covers what changed.** An edit touches
 *   `garments.detail(id)` and `garments.lists()`, never `garments.all`, so the images query
 *   nested under the detail key is not thrown away by a title change.
 * - **Optimistic, with a real rollback (D-18).** `onMutate` snapshots the cache and writes the
 *   expected result; `onError` puts the snapshot back and hands the caller an `ApiError` to turn
 *   into copy. Nothing is left half-applied on screen after a failure.
 */

/* ================================================================== *
 * Reads
 * ================================================================== */

export function useGarmentList(
  query: AdminGarmentQuery,
  initialData?: Paginated<AdminGarment>,
): UseQueryResult<Paginated<AdminGarment>, ApiError> {
  return useQuery<Paginated<AdminGarment>, ApiError>({
    queryKey: queryKeys.garments.list(query),
    queryFn: ({ signal }) => listGarments(query, signal),
    // The previous page stays on screen while the next one loads: a table replaced by a
    // full-height skeleton on every keystroke reads as a failure (D-8).
    placeholderData: keepPreviousData,
    // §6.4 — a catalog row changes only when an admin publishes one, not every 60s.
    staleTime: STALE_TIMES.catalog,
    initialData,
  });
}

export function useGarment(
  garmentId: Uuid,
  initialData?: AdminGarment,
): UseQueryResult<AdminGarment, ApiError> {
  return useQuery<AdminGarment, ApiError>({
    queryKey: queryKeys.garments.detail(garmentId),
    queryFn: ({ signal }) => getGarment(garmentId, signal),
    staleTime: STALE_TIMES.catalog,
    initialData,
  });
}

/* ================================================================== *
 * Writes
 * ================================================================== */

export function useCreateGarment(): UseMutationResult<AdminGarment, ApiError, CreateGarmentBody> {
  const queryClient = useQueryClient();

  return useMutation<AdminGarment, ApiError, CreateGarmentBody>({
    mutationFn: createGarment,
    onSuccess: (garment) => {
      queryClient.setQueryData(queryKeys.garments.detail(garment.id), garment);
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
      // A new draft changes a category's total, which the tree shows.
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('admin') });
    },
  });
}

export interface UpdateGarmentVariables {
  garmentId: Uuid;
  body: UpdateGarmentBody;
}

interface GarmentSnapshot {
  previous: AdminGarment | undefined;
}

/**
 * D-18 — the edit lands on screen immediately and is rolled back with a clear message if the
 * API refuses it.
 *
 * The optimistic value is the merge of the patch onto the cached record, not a re-derivation:
 * anything the server computes (`publishable`, `slug`, the counters) keeps its previous value
 * until the response replaces the whole record.
 */
export function useUpdateGarment(): UseMutationResult<
  AdminGarment,
  ApiError,
  UpdateGarmentVariables,
  GarmentSnapshot
> {
  const queryClient = useQueryClient();

  return useMutation<AdminGarment, ApiError, UpdateGarmentVariables, GarmentSnapshot>({
    mutationFn: ({ garmentId, body }) => updateGarment(garmentId, body),
    onMutate: async ({ garmentId, body }) => {
      const key = queryKeys.garments.detail(garmentId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<AdminGarment>(key);
      if (previous) {
        queryClient.setQueryData<AdminGarment>(key, { ...previous, ...body });
      }
      return { previous };
    },
    onError: (_error, { garmentId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.garments.detail(garmentId), context.previous);
      }
    },
    onSuccess: (garment) => {
      queryClient.setQueryData(queryKeys.garments.detail(garment.id), garment);
    },
    onSettled: (_data, _error, { garmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
    },
  });
}

export interface DeleteGarmentVariables {
  garmentId: Uuid;
  /** Must match the stored title. The API checks it too — the dialog is not the safeguard. */
  confirmTitle: string;
}

export function useDeleteGarment(): UseMutationResult<void, ApiError, DeleteGarmentVariables> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, DeleteGarmentVariables>({
    mutationFn: ({ garmentId, confirmTitle }) => deleteGarment(garmentId, { confirmTitle }),
    onSuccess: (_data, { garmentId }) => {
      queryClient.removeQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('admin') });
    },
  });
}

/** The three publish-state transitions (A-13). Each is one deliberate call, never a patch. */
export type GarmentStateAction = 'publish' | 'unpublish' | 'archive';

const STATE_ACTIONS: Readonly<Record<GarmentStateAction, (id: Uuid) => Promise<AdminGarment>>> = {
  publish: publishGarment,
  unpublish: unpublishGarment,
  archive: archiveGarment,
};

export interface GarmentStateVariables {
  garmentId: Uuid;
  action: GarmentStateAction;
}

/**
 * Publishing is **not** optimistic. It is gated server-side by A-11 and A-10, and showing
 * "Published" for a moment before snapping back would be the interface lying about the one
 * transition an admin most needs to trust.
 */
export function useGarmentStateChange(): UseMutationResult<
  AdminGarment,
  ApiError,
  GarmentStateVariables
> {
  const queryClient = useQueryClient();

  return useMutation<AdminGarment, ApiError, GarmentStateVariables>({
    mutationFn: ({ garmentId, action }) => STATE_ACTIONS[action](garmentId),
    onSuccess: (garment) => {
      queryClient.setQueryData(queryKeys.garments.detail(garment.id), garment);
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
      // Publishing moves a category's A-7 counter, which decides whether it can be deleted.
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('admin') });
    },
  });
}

export interface QualityOverrideVariables {
  garmentId: Uuid;
  reason: string;
}

/** A-10 — records the waiver and the audit row. It publishes nothing on its own. */
export function useOverrideQuality(): UseMutationResult<
  AdminGarment,
  ApiError,
  QualityOverrideVariables
> {
  const queryClient = useQueryClient();

  return useMutation<AdminGarment, ApiError, QualityOverrideVariables>({
    mutationFn: ({ garmentId, reason }) => overrideGarmentQuality(garmentId, { reason }),
    onSuccess: (garment) => {
      queryClient.setQueryData(queryKeys.garments.detail(garment.id), garment);
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
    },
  });
}

/** A-12 / D-16 — resolves with per-item results whether or not every item succeeded. */
export function useBulkGarments(): UseMutationResult<BulkGarmentResult, ApiError, BulkGarmentBody> {
  const queryClient = useQueryClient();

  return useMutation<BulkGarmentResult, ApiError, BulkGarmentBody>({
    mutationFn: bulkGarments,
    onSuccess: (result) => {
      for (const item of result.results) {
        if (item.succeeded) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.garments.detail(item.garmentId),
          });
        }
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories.tree('admin') });
    },
  });
}
