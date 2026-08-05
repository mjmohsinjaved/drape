import 'server-only';

import { cookies, headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';

import { isApiError } from '@repo/api-client';
import { createServerApiClient } from '@repo/api-client/server';

import { ErrorCodes, type ErrorCode } from '@/lib/constants';

/**
 * Cookie-forwarding reads for Server Components — PRD B-9.
 *
 * **There is no proxy layer in the web service.** Server Components read through this helper,
 * which forwards the incoming `drape.sid` cookie to the API; the browser calls the API
 * directly for every mutation via `@repo/api-client`. Nothing here decides authorisation —
 * the API is the sole authority (S-3).
 *
 * `createServerApiClient()` lives behind the `@repo/api-client/server` subpath because it
 * carries `import 'server-only'` (ARCHITECTURE §6.4) and must never enter a client bundle.
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface ServerApiFailure {
  statusCode: number;
  errorCode: ErrorCode | string;
  /**
   * The server's own message. Safe to log, **not** display copy: it is English only, and this
   * app is bilingual (C-41). Screens select copy from {@link errorCode} through
   * `useErrorCopy(namespace)` — see the note on `ApiError` in `@repo/api-client`.
   */
  message: string;
  requestId?: string;
  isRetryable: boolean;
}

export type ServerResult<T> =
  { ok: true; data: T; meta?: PaginationMeta } | { ok: false; error: ServerApiFailure };

export interface ServerRequestOptions {
  /** Forwarded to the API as query parameters. */
  params?: Record<string, string | number | boolean | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Normalises anything thrown by axios into a displayable failure. Server Components render a
 * D-5 state from this; they never surface a status code, a stack trace or a raw axios error.
 */
function toFailure(error: unknown): ServerApiFailure {
  // `createServerApiClient()` installs the shared response interceptor, so by the
  // time anything reaches here it is already an `ApiError` — a flat class with
  // `statusCode`/`errorCode`, and deliberately no `.response`. Re-deriving the
  // failure from a raw axios shape matched nothing and collapsed every
  // server-rendered error to NETWORK_ERROR, which made every D-5
  // permission-denied, not-found and quota state on a Server Component
  // unreachable. The interceptor is the single normalisation point; this only
  // adapts its output.
  if (isApiError(error)) {
    return {
      statusCode: error.statusCode,
      errorCode: error.errorCode,
      message: error.message,
      requestId: error.requestId,
      isRetryable: error.isRetryable,
    };
  }

  // Anything that reaches here bypassed the interceptor entirely — a throw from
  // our own code, not a response.
  return {
    statusCode: 0,
    errorCode: ErrorCodes.UNKNOWN_ERROR,
    message: '',
    isRetryable: false,
  };
}

/**
 * Builds the per-request client, forwarding the incoming `drape.sid` cookie so the API can
 * resolve the caller's session (B-9). Without the cookie header every read here would be
 * anonymous, and `/auth/me` would answer `AUTH_REQUIRED` for a signed-in visitor.
 *
 * A fresh instance per request, never a module singleton — a shared one would carry one
 * visitor's cookie into another visitor's render.
 */
async function requestScopedClient() {
  const cookieHeader = (await cookies()).toString();
  const requestId = (await headers()).get('x-request-id') ?? undefined;
  return createServerApiClient(cookieHeader, { requestId });
}

/**
 * A GET that never throws **a failure**. The caller renders the error state instead of blowing
 * up the segment, which is what D-5 asks for: states are rendered, not thrown.
 *
 * The one thing it does rethrow is Next's own control flow. `requestScopedClient()` reads
 * `cookies()`, and during a static render that read throws the dynamic-usage signal that tells
 * Next to bail this segment out of prerendering; `redirect()` and `notFound()` travel the same
 * way. Swallowing those turns a session-scoped page into a build-time snapshot of a signed-out,
 * data-less shell — and because this helper deliberately never surfaces a failure, the snapshot
 * would bake in silently rather than failing the build. `unstable_rethrow` is Next's own guard
 * for exactly this: it rethrows the framework's internal errors and returns for everything else.
 *
 * `createServerApiClient` attaches the package's response interceptor, which has already
 * unwrapped the §2.3 envelope — `response.data` is the payload, and a paginated route arrives
 * as `{ items, meta }`. Nothing here unwraps a second time.
 */
export async function serverGet<T>(
  path: string,
  options: ServerRequestOptions = {},
): Promise<ServerResult<T>> {
  try {
    const client = await requestScopedClient();
    const response = await client.get<T | { items: T; meta: PaginationMeta }>(path, {
      params: options.params,
    });
    const payload = response.data;

    if (isPaginatedPayload<T>(payload)) {
      return { ok: true, data: payload.items, meta: payload.meta };
    }
    return { ok: true, data: payload };
  } catch (error: unknown) {
    // Must come first. A dynamic-usage bailout, a `redirect()` or a `notFound()` is Next talking
    // to itself, not an API failure, and catching it is what made these routes prerenderable.
    unstable_rethrow(error);
    return { ok: false, error: toFailure(error) };
  }
}

/** True for the `{ items, meta }` shape the interceptor lifts a §2.8 list response into. */
function isPaginatedPayload<T>(value: unknown): value is { items: T; meta: PaginationMeta } {
  return isRecord(value) && Array.isArray(value.items) && isRecord(value.meta);
}

/**
 * A GET that collapses every failure to `null`. Use it for optional reads — the session probe,
 * the brand config — where the page has a sensible shape without the data.
 */
export async function serverGetOrNull<T>(
  path: string,
  options: ServerRequestOptions = {},
): Promise<T | null> {
  const result = await serverGet<T>(path, options);
  return result.ok ? result.data : null;
}

/** Type guard so a Server Component can branch without repeating the discriminant. */
export function isFailure<T>(
  result: ServerResult<T>,
): result is { ok: false; error: ServerApiFailure } {
  return !result.ok;
}
