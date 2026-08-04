/**
 * TanStack Query defaults — ARCHITECTURE.md §6.4.
 *
 * `throwOnError: false` is load-bearing: D-5 requires every screen to *render* its loading, empty,
 * error, permission-denied and success states, so a failed query returns an error to the component
 * rather than blowing up to the nearest error boundary.
 */

import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './types/envelope';

/** §6.4 — one minute. */
export const DEFAULT_STALE_TIME_MS = 60_000;

/** §6.4 — five minutes. */
export const DEFAULT_GC_TIME_MS = 5 * 60_000;

/** §6.4 — two retries at most, so a hard outage fails within a few seconds rather than a minute. */
export const MAX_QUERY_RETRIES = 2;

/**
 * Per-query `staleTime` overrides called out in §6.4. Exported so feature hooks quote the constant
 * instead of re-deciding the number.
 */
export const STALE_TIMES = {
  /** Catalog lists change only when an admin publishes. */
  catalog: 5 * 60_000,
  /** `auth.me` is invalidated explicitly on login and logout, never by a timer. */
  authMe: Number.POSITIVE_INFINITY,
  /** Quota changes on every generation (C-5). */
  quotaMe: 0,
  /** Brand settings theme the whole app; they change rarely and cost a flash when they do. */
  brandSettings: 10 * 60_000,
} as const;

/**
 * The retry predicate.
 *
 * **It never retries a 4xx.** A 400 will fail identically the second time, a 401/403 is an
 * authorisation answer and not a transient fault, a 404 is an answer, and — deliberately — a 408
 * or 429 is left to an explicit user action rather than an automatic retry, so the client cannot
 * amplify load against a rate limiter it has already tripped. `ApiError.isRetryable` is the wider
 * predicate that drives the "Try again" button in the D-5 error state; this one is narrower on
 * purpose.
 *
 * Anything that is not an `ApiError` never reached the interceptor, so it is a programmer error
 * rather than a transport failure and is not retried either.
 */
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  if (!(error instanceof ApiError)) return false;

  // 4xx — never. This includes 408 and 429.
  if (error.statusCode >= 400 && error.statusCode < 500) return false;

  // Requests that never reached the API: retrying is exactly the right move.
  if (error.errorCode === 'NETWORK_ERROR') return true;

  // An abort is a deliberate cancellation, usually an unmount.
  if (error.errorCode === 'REQUEST_ABORTED') return false;

  return error.statusCode >= 500;
}

/** Exponential backoff, capped at 15 s (§6.4). */
export function retryDelayMs(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 15_000);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        gcTime: DEFAULT_GC_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: shouldRetryRequest,
        retryDelay: retryDelayMs,
        // D-5: states are rendered, not thrown.
        throwOnError: false,
      },
      mutations: {
        // A mutation is not idempotent unless the endpoint says so, and only `POST /tryon` carries
        // an idempotency key. Retrying blindly could double-charge quota.
        retry: false,
      },
    },
  });
}
