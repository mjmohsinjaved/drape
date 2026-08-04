/**
 * The Server Component axios instance — ARCHITECTURE.md §6.4, PRD B-9.
 *
 * A Server Component has no cookie jar of its own, so the incoming request's cookie header must be
 * forwarded explicitly. **There is no proxy route handler in the web app** (B-9): Server
 * Components read through this client, and the browser calls the API directly for mutations.
 *
 * The cookie header is a parameter rather than a `next/headers` read so this package stays free of
 * a `next` dependency and can be unit-tested without a request scope. The web app's
 * `apps/web/src/lib/server-api.ts` is the thin wrapper that supplies it:
 *
 * ```ts
 * import 'server-only';
 * import { cookies, headers } from 'next/headers';
 * import { createServerApiClient } from '@repo/api-client/server';
 *
 * export async function serverApi() {
 *   const cookieHeader = (await cookies()).toString();
 *   const requestId = (await headers()).get('x-request-id') ?? undefined;
 *   return createServerApiClient(cookieHeader, { requestId });
 * }
 * ```
 *
 * **Never call this from a Client Component.** It forwards the caller's session cookie; in a
 * browser bundle that is both useless and a leak of intent.
 */

import axios, { type AxiosInstance } from 'axios';

import { REQUEST_ID_HEADER, SERVER_TIMEOUT_MS, generateRequestId, getServerApiBaseUrl } from './config';
import { setupResponseInterceptor } from './interceptors/response.interceptor';

export interface ServerApiClientOptions {
  /** Propagated so one browser request and every server-side fetch it triggers share an id (E-12). */
  requestId?: string;
  /** Overrides `API_INTERNAL_URL` / `NEXT_PUBLIC_API_BASE_URL`. Only tests should need this. */
  baseURL?: string;
  timeout?: number;
}

/**
 * Builds a per-request client that forwards the incoming cookie header to the API.
 *
 * A fresh instance per request, never a module singleton: a shared instance would leak one
 * visitor's cookie into another visitor's render.
 *
 * The request interceptor is deliberately **not** attached — there is no `document.cookie` to read
 * a CSRF token from, and a Server Component only ever reads. The response interceptor is attached
 * so a server-side failure is the same `ApiError` the browser would have seen; its redirect branch
 * is inert here because `window` is undefined.
 */
export function createServerApiClient(
  cookieHeader?: string,
  options: ServerApiClientOptions = {},
): AxiosInstance {
  const requestId = options.requestId ?? generateRequestId();

  const instance = axios.create({
    baseURL: options.baseURL ?? getServerApiBaseUrl(),
    timeout: options.timeout ?? SERVER_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      [REQUEST_ID_HEADER]: requestId,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  setupResponseInterceptor(instance);

  return instance;
}
