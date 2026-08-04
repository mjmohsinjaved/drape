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
import { type ApiError, type Paginated } from '../types/envelope';

export interface ApiQueryOptions<TData>
  extends Omit<UseQueryOptions<TData, ApiError, TData, readonly unknown[]>, 'queryFn'> {
  /** Path relative to `NEXT_PUBLIC_API_BASE_URL`, e.g. `/catalog/garments`. */
  url: string;
  params?: Record<string, unknown>;
}

/**
 * A single-resource GET. `signal` is forwarded to axios so TanStack can abort an in-flight
 * request on unmount — the resulting `REQUEST_ABORTED` is never retried.
 */
export function useApiQuery<TData>({
  url,
  params,
  ...options
}: ApiQueryOptions<TData>): UseQueryResult<TData, ApiError> {
  return useQuery<TData, ApiError, TData, readonly unknown[]>({
    ...options,
    queryFn: async ({ signal }) => {
      const response = await apiClient.get<TData>(url, { params, signal });
      return response.data;
    },
  });
}

export interface PaginatedQueryOptions<TItem>
  extends Omit<
    UseQueryOptions<Paginated<TItem>, ApiError, Paginated<TItem>, readonly unknown[]>,
    'queryFn'
  > {
  url: string;
  params?: Record<string, unknown>;
}

/**
 * A list GET. The interceptor lifts the envelope's `meta` beside the rows, so this resolves to
 * `{ items, meta }` (§2.3, §2.8).
 *
 * `placeholderData: keepPreviousData` keeps the previous page on screen while the next one loads,
 * which is what D-5's loading state expects for a paginated table — a spinner replacing a full
 * table on every page change reads as a failure.
 */
export function usePaginatedQuery<TItem>({
  url,
  params,
  ...options
}: PaginatedQueryOptions<TItem>): UseQueryResult<Paginated<TItem>, ApiError> {
  return useQuery<Paginated<TItem>, ApiError, Paginated<TItem>, readonly unknown[]>({
    placeholderData: keepPreviousData,
    ...options,
    queryFn: async ({ signal }) => {
      const response = await apiClient.get<Paginated<TItem>>(url, { params, signal });
      return response.data;
    },
  });
}
