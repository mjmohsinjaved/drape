/**
 * The browser axios instance — ARCHITECTURE.md §6.4.
 *
 * **There are no bearer tokens anywhere in the frontend.** Authentication is the `drape.sid`
 * httpOnly cookie, carried by `withCredentials`. There is no refresh-token interceptor, no
 * `Authorization` header, and nothing is ever written to `localStorage` (B-6) — there is no token
 * to store. The only header this client adds beyond the CSRF double-submit is `X-Request-Id`.
 */

import axios, { type AxiosInstance } from 'axios';

import { BROWSER_TIMEOUT_MS, getApiBaseUrl } from './config';
import { ensureCsrf, setCsrfFetcher } from './csrf';
import { setupRequestInterceptor } from './interceptors/request.interceptor';
import { setupResponseInterceptor } from './interceptors/response.interceptor';
import { type CsrfTokenResponse } from './types/auth';

/**
 * The single browser instance. Feature hooks live in `apps/web/src/features/<name>/hooks/` and call
 * typed endpoint functions — **features never call `apiClient` directly** (§6.4).
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: BROWSER_TIMEOUT_MS,
  // The session cookie — B-6. Requires the API's CORS allow-list to name the web origin exactly;
  // `CORS_ORIGINS` is never `*`, in any environment (B-7).
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

setupRequestInterceptor(apiClient);
setupResponseInterceptor(apiClient);

// `GET /auth/csrf` issues the readable `drape.csrf` cookie. Registered rather than imported so the
// csrf module and the axios instance do not form a cycle.
setCsrfFetcher(() => apiClient.get<CsrfTokenResponse>('/auth/csrf'));

export { ensureCsrf };

/**
 * The Server Component variant (B-9). Re-exported here so both instances are discoverable from one
 * place; it lives in its own module because it must never be pulled into a client bundle.
 */
export { createServerApiClient, type ServerApiClientOptions } from './server-instance';
