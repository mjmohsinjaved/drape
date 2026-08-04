/**
 * Typed mutation wrapper.
 *
 * `invalidateKeys` exists so a call site states its invalidation next to the mutation instead of
 * hiding it in an `onSuccess` somewhere else. §6.4's rule stands: **invalidate the narrowest key
 * that covers what changed** — a verdict invalidates `results.detail(id)`, `results.lists()` and
 * `shortlist.list()`, never `queryKeys.results.all`.
 *
 * Mutations never auto-retry (§6.4). Only `POST /tryon` carries an idempotency key; retrying
 * anything else blindly risks a duplicate write.
 */

import {
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { apiClient } from '../axios-instance';
import { type ApiError } from '../types/envelope';

export type MutationMethod = 'post' | 'put' | 'patch' | 'delete';

export interface ApiMutationOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'> {
  /** A static path, or one derived from the variables (`(vars) => \`/results/${vars.id}/verdict\``). */
  url: string | ((variables: TVariables) => string);
  method?: MutationMethod;
  /** Keys to invalidate on success. Keep them narrow. */
  invalidateKeys?: ReadonlyArray<readonly unknown[]>;
  /**
   * Sends the variables as query params instead of a body. Needed for the handful of `DELETE`
   * routes that take a confirmation payload.
   */
  sendAsParams?: boolean;
}

export function useApiMutation<TData, TVariables = void>({
  url,
  method = 'post',
  invalidateKeys,
  sendAsParams = false,
  onSuccess,
  ...options
}: ApiMutationOptions<TData, TVariables>): UseMutationResult<TData, ApiError, TVariables> {
  const queryClient = useQueryClient();

  return useMutation<TData, ApiError, TVariables>({
    ...options,
    mutationFn: async (variables) => {
      const resolvedUrl = typeof url === 'function' ? url(variables) : url;

      if (method === 'delete') {
        const response = await apiClient.delete<TData>(resolvedUrl, {
          ...(sendAsParams ? { params: variables } : { data: variables }),
        });
        return response.data;
      }

      const response = await apiClient[method]<TData>(resolvedUrl, variables);
      return response.data;
    },
    // Forwarded with a rest parameter so this stays correct as TanStack adds
    // arguments to the callback — v5.90 introduced a fourth (`mutation`).
    onSuccess: (...args) => {
      if (invalidateKeys) {
        for (const queryKey of invalidateKeys) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
      onSuccess?.(...args);
    },
  });
}
