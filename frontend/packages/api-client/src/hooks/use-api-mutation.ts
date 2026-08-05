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

import type { ApiError } from '../types/envelope';

export type MutationMethod = 'post' | 'put' | 'patch' | 'delete';

interface BaseApiMutationOptions<TData, TVariables>
  extends Omit<UseMutationOptions<TData, ApiError, TVariables>, 'mutationFn'> {
  /** Keys to invalidate on success. Keep them narrow. */
  invalidateKeys?: ReadonlyArray<readonly unknown[]>;
}

/** The path form, for a route with no endpoint function of its own yet. */
interface UrlMutationOptions<TData, TVariables> extends BaseApiMutationOptions<TData, TVariables> {
  /** A static path, or one derived from the variables (`(vars) => \`/results/${vars.id}/verdict\``). */
  url: string | ((variables: TVariables) => string);
  method?: MutationMethod;
  /**
   * Sends the variables as query params instead of a body. Needed for the handful of `DELETE`
   * routes that take a confirmation payload.
   */
  sendAsParams?: boolean;
  request?: never;
}

/**
 * The endpoint form — **prefer this**.
 *
 * `request` is one of the typed functions in `endpoints/` (§6.4), so the call site names a route
 * rather than a string and the request and response types come from the contract instead of
 * being restated at the call site.
 */
interface RequestMutationOptions<TData, TVariables>
  extends BaseApiMutationOptions<TData, TVariables> {
  request: (variables: TVariables) => Promise<TData>;
  url?: never;
  method?: never;
  sendAsParams?: never;
}

export type ApiMutationOptions<TData, TVariables> =
  | UrlMutationOptions<TData, TVariables>
  | RequestMutationOptions<TData, TVariables>;

export function useApiMutation<TData, TVariables = void>(
  options: ApiMutationOptions<TData, TVariables>,
): UseMutationResult<TData, ApiError, TVariables> {
  const {
    invalidateKeys,
    onSuccess,
    url: _url,
    method: _method,
    sendAsParams: _sendAsParams,
    request: _request,
    ...queryOptions
  } = options;
  const queryClient = useQueryClient();

  return useMutation<TData, ApiError, TVariables>({
    ...queryOptions,
    // Narrowed off `options` rather than the destructured locals, so the union discriminates
    // and neither branch needs a cast.
    mutationFn: async (variables) => {
      // The endpoint form: the typed function in `endpoints/` already knows the path, the verb
      // and both shapes, so there is nothing left here to resolve.
      if (options.request !== undefined) return options.request(variables);

      const { url, method = 'post', sendAsParams = false } = options;
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
