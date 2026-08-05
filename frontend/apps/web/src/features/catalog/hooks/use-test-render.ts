'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { queryKeys, type ApiError, type Uuid } from '@repo/api-client';

import {
  approveTestRender,
  estimateBulkTestRender,
  getTestRender,
  getTestRenderBatch,
  listReferenceModels,
  queueBulkTestRender,
  rejectTestRender,
  runTestRender,
} from '@/features/catalog/api/endpoints';

import type {
  BulkTestRenderBody,
  BulkTestRenderQueued,
  ReferenceModel,
  TestRender,
  TestRenderBatch,
  TestRenderEstimate,
} from '@/features/catalog/types/admin-catalog';

/**
 * The A-11 gate and the A-12 batch.
 *
 * Approving a test render is the transition that unblocks publishing, so it invalidates the
 * garment detail and the list alongside the render itself — a stale "cannot publish" badge on
 * the row an admin just approved is the worst kind of lie for this screen.
 */

export function useReferenceModels(
  initialData?: ReferenceModel[],
): UseQueryResult<ReferenceModel[], ApiError> {
  return useQuery<ReferenceModel[], ApiError>({
    queryKey: queryKeys.tryon.referenceModels(),
    queryFn: ({ signal }) => listReferenceModels(signal),
    // The built-in reference set changes about as often as a deploy.
    staleTime: 30 * 60_000,
    initialData,
  });
}

/** The key is nested under the garment so a garment invalidation takes its render with it. */
function testRenderKey(garmentId: Uuid): readonly unknown[] {
  return [...queryKeys.garments.detail(garmentId), 'test-render'] as const;
}

export function useTestRender(
  garmentId: Uuid,
  initialData?: TestRender,
): UseQueryResult<TestRender, ApiError> {
  return useQuery<TestRender, ApiError>({
    queryKey: testRenderKey(garmentId),
    queryFn: ({ signal }) => getTestRender(garmentId, signal),
    initialData,
  });
}

export interface RunTestRenderVariables {
  garmentId: Uuid;
  referenceModelId?: Uuid;
}

/** Spends platform budget under `TEST_RENDER`, never a consumer's quota (§8.4). */
export function useRunTestRender(): UseMutationResult<
  TestRender,
  ApiError,
  RunTestRenderVariables
> {
  const queryClient = useQueryClient();

  return useMutation<TestRender, ApiError, RunTestRenderVariables>({
    mutationFn: (variables) => runTestRender(variables),
    onSuccess: (render, { garmentId }) => {
      queryClient.setQueryData(testRenderKey(garmentId), render);
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.quota.all });
    },
  });
}

export interface ApproveTestRenderVariables {
  garmentId: Uuid;
}

export function useApproveTestRender(): UseMutationResult<
  TestRender,
  ApiError,
  ApproveTestRenderVariables
> {
  const queryClient = useQueryClient();

  return useMutation<TestRender, ApiError, ApproveTestRenderVariables>({
    mutationFn: ({ garmentId }) => approveTestRender(garmentId),
    onSuccess: (render, { garmentId }) => {
      queryClient.setQueryData(testRenderKey(garmentId), render);
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
    },
  });
}

export interface RejectTestRenderVariables {
  garmentId: Uuid;
  reason: string;
}

export function useRejectTestRender(): UseMutationResult<
  TestRender,
  ApiError,
  RejectTestRenderVariables
> {
  const queryClient = useQueryClient();

  return useMutation<TestRender, ApiError, RejectTestRenderVariables>({
    mutationFn: ({ garmentId, reason }) => rejectTestRender(garmentId, { reason }),
    onSuccess: (render, { garmentId }) => {
      queryClient.setQueryData(testRenderKey(garmentId), render);
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
    },
  });
}

/** A-12 — read-only. It spends nothing, which is what makes it safe to run on every selection. */
export function useTestRenderEstimate(): UseMutationResult<TestRenderEstimate, ApiError, Uuid[]> {
  return useMutation<TestRenderEstimate, ApiError, Uuid[]>({
    mutationFn: (garmentIds) => estimateBulkTestRender(garmentIds),
  });
}

export function useQueueBulkTestRender(): UseMutationResult<
  BulkTestRenderQueued,
  ApiError,
  BulkTestRenderBody
> {
  return useMutation<BulkTestRenderQueued, ApiError, BulkTestRenderBody>({
    mutationFn: queueBulkTestRender,
  });
}

/**
 * Per-item batch progress (D-16).
 *
 * §5.11 lists an SSE stream at `/admin/tryon/batches/:batchId/stream`, but the implemented
 * `AdminTryOnController` has no such route, so this polls the JSON endpoint every three seconds
 * and stops the moment nothing is pending. Swapping to `useEventSource` when the route lands is
 * a change to this hook and nothing else.
 */
export function useTestRenderBatch(
  batchId: Uuid | null,
): UseQueryResult<TestRenderBatch, ApiError> {
  const queryClient = useQueryClient();

  return useQuery<TestRenderBatch, ApiError>({
    queryKey: batchId ? queryKeys.tryon.batch(batchId) : queryKeys.tryon.all,
    queryFn: ({ signal }) => {
      if (!batchId) throw new Error('A batch id is required');
      return getTestRenderBatch(batchId, signal);
    },
    enabled: batchId !== null,
    refetchInterval: (query) => {
      const batch = query.state.data;
      if (!batch) return 3_000;
      if (batch.pending > 0) return 3_000;
      // The run is over: refresh the rows it touched, once.
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
      return false;
    },
    staleTime: 0,
  });
}
