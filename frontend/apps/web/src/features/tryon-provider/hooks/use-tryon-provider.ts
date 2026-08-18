'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  isApiError,
  queryKeys,
  type ApiError,
  type SelectTryOnProviderRequest,
  type TryOnProviderState,
} from '@repo/api-client';

import { getTryOnProviders, selectTryOnProvider } from '@/features/tryon-provider/api/endpoints';

const PROVIDERS_KEY = queryKeys.tryon.providers();

export function useTryOnProviders(): UseQueryResult<TryOnProviderState, ApiError> {
  return useQuery<TryOnProviderState, ApiError>({
    queryKey: PROVIDERS_KEY,
    queryFn: ({ signal }) => getTryOnProviders(signal),
    staleTime: 0,
  });
}

export function useSelectTryOnProvider(): UseMutationResult<
  TryOnProviderState,
  ApiError,
  SelectTryOnProviderRequest
> {
  const queryClient = useQueryClient();

  return useMutation<TryOnProviderState, ApiError, SelectTryOnProviderRequest>({
    mutationFn: selectTryOnProvider,
    onSuccess: (state) => {
      queryClient.setQueryData(PROVIDERS_KEY, state);
      void queryClient.invalidateQueries({ queryKey: PROVIDERS_KEY });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tryon.all });
    },
  });
}

export function isDriverNotConfigured(error: unknown): boolean {
  return isApiError(error) && error.errorCode === 'SETTINGS_VALUE_INVALID';
}
