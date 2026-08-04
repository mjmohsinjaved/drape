/**
 * `@repo/api-client` — ARCHITECTURE.md §6.4.
 *
 * The whole HTTP surface of the Drape web app: one axios instance for the browser, one factory for
 * Server Components, the §2.3 envelope contract, the §2.4 error codes, typed DTOs for every route
 * in §5, and the TanStack Query defaults and key factory.
 *
 * There are no bearer tokens here, no `localStorage`, and no refresh-token interceptor. The
 * session is the httpOnly `drape.sid` cookie (B-6) and the only header this client adds is the
 * CSRF double-submit token (B-8).
 */

export { apiClient, createServerApiClient, ensureCsrf, type ServerApiClientOptions } from './axios-instance';

export {
  BROWSER_TIMEOUT_MS,
  CSRF_COOKIE_NAME,
  CSRF_HEADER,
  REQUEST_ID_HEADER,
  SAFE_METHODS,
  SERVER_TIMEOUT_MS,
  generateRequestId,
  getApiBaseUrl,
  getServerApiBaseUrl,
  isQueryDevtoolsEnabled,
} from './config';

export { getCsrfToken, readCookie, setCsrfFetcher } from './csrf';

export * from './interceptors';

export {
  DEFAULT_GC_TIME_MS,
  DEFAULT_STALE_TIME_MS,
  MAX_QUERY_RETRIES,
  STALE_TIMES,
  createQueryClient,
  retryDelayMs,
  shouldRetryRequest,
} from './query-client';

export { type QueryKeyRoot, type QueryKeys, queryKeys } from './query-keys';

export * from './providers';

export * from './hooks';

export * from './types';
