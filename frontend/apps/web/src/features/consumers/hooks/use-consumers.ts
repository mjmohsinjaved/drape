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
  approveConsumer,
  listConsumers,
  suspendConsumer,
  unsuspendConsumer,
} from '@/features/consumers/api/endpoints';

export function useConsumerList(
  query: AdminConsumerListQuery,
  initialData?: Paginated<AdminConsumerListItem>,
): UseQueryResult<Paginated<AdminConsumerListItem>, ApiError> {
  return useQuery<Paginated<AdminConsumerListItem>, ApiError>({
    queryKey: queryKeys.consumers.list(query),
    queryFn: ({ signal }) => listConsumers(query, signal),
    placeholderData: keepPreviousData,
    initialData,
  });
}

export interface SuspendConsumerVariables {
  userId: Uuid;
  reason?: string;
}

export function useSuspendConsumer(): UseMutationResult<
  AdminConsumerDetail,
  ApiError,
  SuspendConsumerVariables
> {
  const queryClient = useQueryClient();

  return useMutation<AdminConsumerDetail, ApiError, SuspendConsumerVariables>({
    mutationFn: ({ userId, reason }) =>
      suspendConsumer(userId, reason === undefined ? {} : { reason }),
    onSuccess: async (_detail, { userId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.lists() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.detail(userId) }),
      ]);
    },
  });
}

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

export function useApproveConsumer(): UseMutationResult<AdminConsumerDetail, ApiError, Uuid> {
  const queryClient = useQueryClient();

  return useMutation<AdminConsumerDetail, ApiError, Uuid>({
    mutationFn: (userId) => approveConsumer(userId),
    onSuccess: async (_detail, userId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.lists() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.consumers.detail(userId) }),
      ]);
    },
  });
}
