'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  queryKeys,
  type AdminConsumerListItem,
  type AdminConsumerDetail,
  type AdminConsumerListQuery,
  type ApiError,
  type Paginated,
  type Uuid,
} from '@repo/api-client';

import {
  listConsumers,
  suspendConsumer,
  unsuspendConsumer,
} from '@/features/consumers/api/endpoints';

/**
 * Server state for consumer management — ARCHITECTURE §6.4.
 *
 * No `staleTime`: unlike a catalog row, which changes only when an
 * admin publishes, these rows move on their own. "Generations this month", "last active" and the
 * shortlist size all change as she uses the app, so this list takes the client's default and
 * refetches when the console is focused again.
 */
export function useConsumerList(
  query: AdminConsumerListQuery,
  initialData?: Paginated<AdminConsumerListItem>,
): UseQueryResult<Paginated<AdminConsumerListItem>, ApiError> {
  return useQuery<Paginated<AdminConsumerListItem>, ApiError>({
    queryKey: queryKeys.consumers.list(query),
    queryFn: ({ signal }) => listConsumers(query, signal),
    // The previous page stays on screen while the next one loads: a table replaced by a
    // full-height skeleton on every keystroke reads as a failure (D-8).
    placeholderData: keepPreviousData,
    initialData,
  });
}

/* ================================================================== *
 * Writes
 * ================================================================== */

export interface SuspendConsumerVariables {
  userId: Uuid;
  reason: string;
}

/**
 * A-19 — put an account on hold.
 *
 * Both keys are invalidated rather than patched: suspending revokes her sessions and changes
 * `suspendedAt`, `suspendedReason` and the status in one server-side transaction, and the row
 * this screen should show afterwards is the one the API just wrote. There is no optimistic
 * write here for the same reason — a status the browser guessed at is exactly the thing an
 * admin must not be shown while deciding whether someone can sign in.
 */
export function useSuspendConsumer(): UseMutationResult<
  AdminConsumerDetail,
  ApiError,
  SuspendConsumerVariables
> {
  const queryClient = useQueryClient();

  return useMutation<AdminConsumerDetail, ApiError, SuspendConsumerVariables>({
    mutationFn: ({ userId, reason }) => suspendConsumer(userId, { reason }),
    onSuccess: async (_detail, { userId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.lists() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.detail(userId) }),
      ]);
    },
  });
}

/** Lifts the hold. She can sign in again on her next attempt; old sessions stay revoked. */
export function useUnsuspendConsumer(): UseMutationResult<AdminConsumerDetail, ApiError, Uuid> {
  const queryClient = useQueryClient();

  return useMutation<AdminConsumerDetail, ApiError, Uuid>({
    mutationFn: (userId) => unsuspendConsumer(userId),
    onSuccess: async (_detail, userId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.lists() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.detail(userId) }),
      ]);
    },
  });
}
