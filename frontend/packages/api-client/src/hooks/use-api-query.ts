/**
 * Typed query wrappers.
 *
 * The response interceptor has already unwrapped the §2.3 envelope, so `TData` here is the payload
 * — never `ApiResponse<TData>`. The error type is always `ApiError`, because the interceptor
 * normalises every failure (§6.4).
 *
 * Feature hooks (`useGetGarments`, `useCreateGarment`, …) live in `apps/web/src/features/<name>/hooks/`
 * and build on these; features never call `apiClient` directly.
 */

import {
  type UseQueryOptions,
  type UseQueryResult,
  keepPreviousData,
  useQuery,
} from '@tanstack/react-query';

import { apiClient } from '../axios-instance';

import type { ApiError, Paginated } from '../types/envelope';

interface BaseQueryOptions<TData>
  extends Omit<UseQueryOptions<TData, ApiError, TData, readonly unknown[]>, 'queryFn'> {
  /** Path relative to `NEXT_PUBLIC_API_BASE_URL`, e.g. `/catalog/garments`. */
  url: string;
  params?: Record<string, unknown>;
  request?: never;
}

/**
 * The endpoint form — **prefer this**.
 *
 * `request` is one of the typed functions in `endpoints/` (§6.4). It receives the abort signal so
 * a superseded query still stops in flight.
 */
interface RequestQueryOptions<TData>
  extends Omit<UseQueryOptions<TData, ApiError, TData, readonly unknown[]>, 'queryFn'> {
  request: (signal: AbortSignal) => Promise<TData>;
  url?: never;
  params?: never;
}

export type ApiQueryOptions<TData> = BaseQueryOptions<TData> | RequestQueryOptions<TData>;

/**
 * A single-resource GET. `signal` is forwarded to axios so TanStack can abort an in-flight
 * request on unmount — the resulting `REQUEST_ABORTED` is never retried.
 */
export function useApiQuery<TData>(
  options: ApiQueryOptions<TData>,
): UseQueryResult<TData, ApiError> {
  const { url: _url, params: _params, request: _request, ...queryOptions } = options;

  return useQuery<TData, ApiError, TData, readonly unknown[]>({
    ...queryOptions,
    queryFn: async ({ signal }) => {
      if (options.request !== undefined) return options.request(signal);

      const response = await apiClient.get<TData>(options.url, { params: options.params, signal });
      return response.data;
    },
  });
}

export type PaginatedQueryOptions<TItem> = ApiQueryOptions<Paginated<TItem>>;

/**
 * A list GET. The interceptor lifts the envelope's `meta` beside the rows, so this resolves to
 * `{ items, meta }` (§2.3, §2.8).
 *
 * `placeholderData: keepPreviousData` keeps the previous page on screen while the next one loads,
 * which is what D-5's loading state expects for a paginated table — a spinner replacing a full
 * table on every page change reads as a failure.
 */
export function usePaginatedQuery<TItem>(
  options: PaginatedQueryOptions<TItem>,
): UseQueryResult<Paginated<TItem>, ApiError> {
  const { url: _url, params: _params, request: _request, ...queryOptions } = options;

  return useQuery<Paginated<TItem>, ApiError, Paginated<TItem>, readonly unknown[]>({
    placeholderData: keepPreviousData,
    ...queryOptions,
    queryFn: async ({ signal }) => {
      if (options.request !== undefined) return options.request(signal);

      const response = await apiClient.get<Paginated<TItem>>(options.url, {
        params: options.params,
        signal,
      });
      return response.data;
    },
  });
}
