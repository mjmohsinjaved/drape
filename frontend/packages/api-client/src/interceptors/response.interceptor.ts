/**
 * Response interceptor — ARCHITECTURE.md §2.3 and §6.4.
 *
 * Two jobs, and only these two:
 *
 * 1. **Unwrap the envelope.** Application code receives `data`, never `{ success, statusCode,
 *    message, data, … }`. A paginated response is lifted to `{ items, meta }` so the pagination
 *    block travels with the rows instead of being stranded on the transport shape.
 * 2. **Normalise every failure into an `ApiError`.** Every rejection reaching application code is
 *    an `ApiError` — never a raw `AxiosError`, and never an un-shaped network failure. Requests
 *    that never reached the API have no envelope to unwrap, so the client synthesises one of
 *    `NETWORK_ERROR` / `REQUEST_TIMEOUT` / `REQUEST_ABORTED` / `UNKNOWN_ERROR`.
 */

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

import { ensureCsrf } from '../csrf';
import {
  ApiError,
  type FieldError,
  type PaginationMeta,
  isApiError,
  isApiErrorResponse,
  isApiResponse,
} from '../types/envelope';
import { SESSION_ENDED_ERROR_CODES } from '../types/error-codes';

import { type DrapeRequestConfig } from './request.interceptor';

/** The envelope fields that are not the payload, kept on the response for callers that need them. */
export interface EnvelopeMeta {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
  requestId: string;
  meta?: PaginationMeta;
}

export interface DrapeAxiosResponse<TData = unknown> extends AxiosResponse<TData> {
  /** Present once {@link unwrapEnvelope} has run. Absent on a non-enveloped body. */
  envelope?: EnvelopeMeta;
}

/**
 * Copy for the two failures that never reach the API and therefore have no server message. §6.4
 * requires these to be translated locally; the strings below are the English source that the web
 * app's i18n layer keys off {@link ApiError.errorCode}.
 */
export const CLIENT_ERROR_MESSAGES = {
  NETWORK_ERROR: "You appear to be offline. We'll retry when you're back.",
  REQUEST_TIMEOUT: 'That took too long. Try again.',
  REQUEST_ABORTED: 'That request was cancelled.',
  UNKNOWN_ERROR: 'Something went wrong. Try again.',
} as const;

/* ------------------------------------------------------------------ unwrapping */

/**
 * Replaces `response.data` with the envelope's payload.
 *
 * - Single resource → the resource.
 * - Paginated list (the envelope carries `meta`) → `{ items, meta }`, i.e. `Paginated<T>`.
 * - A body that is not an envelope is passed through untouched: `GET /files/:token` streams
 *   binary and the SSE stream never goes through axios, but a proxy or an error page can still
 *   land here.
 */
export function unwrapEnvelope<TData = unknown>(
  response: AxiosResponse<unknown>,
): DrapeAxiosResponse<TData> {
  const enriched = response as DrapeAxiosResponse<TData>;
  const body = response.data;

  if (!isApiResponse(body)) return enriched;

  enriched.envelope = {
    statusCode: body.statusCode,
    message: body.message,
    timestamp: body.timestamp,
    path: body.path,
    requestId: body.requestId,
    meta: body.meta,
  };

  enriched.data = (
    body.meta === undefined ? body.data : { items: body.data, meta: body.meta }
  ) as TData;

  return enriched;
}

/* ----------------------------------------------------------- error normalisation */

function readFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is FieldError =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as FieldError).field === 'string' &&
      typeof (entry as FieldError).message === 'string',
  );
}

function isTimeout(code: string | undefined, message: string): boolean {
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || message.includes('timeout');
}

/**
 * Turns anything a rejected request can produce into an `ApiError`.
 *
 * The order of the branches matters: an aborted request looks like a network failure, and a
 * timeout looks like an abort, so the specific cases are tested before the general one.
 */
export function normaliseError(error: unknown): ApiError {
  if (isApiError(error)) return error;

  if (axios.isCancel(error)) {
    return new ApiError({
      statusCode: 0,
      errorCode: 'REQUEST_ABORTED',
      message: CLIENT_ERROR_MESSAGES.REQUEST_ABORTED,
      cause: error,
    });
  }

  if (axios.isAxiosError(error)) {
    const requestId = (error.config as DrapeRequestConfig | undefined)?.requestId;
    const body: unknown = error.response?.data;

    // The API answered with the §2.3 error envelope — this is the common path.
    if (isApiErrorResponse(body)) {
      return new ApiError({
        statusCode: body.statusCode || (error.response?.status ?? 0),
        errorCode: body.errorCode,
        message: body.message,
        errors: readFieldErrors(body.errors),
        details: body.details,
        requestId: body.requestId || requestId,
        path: body.path,
        cause: error,
      });
    }

    // A response arrived with no recognisable envelope: a proxy error page, a 502 from an
    // intermediary, a mangled body. Never surface the raw body — it is not user-safe copy.
    if (error.response) {
      return new ApiError({
        statusCode: error.response.status,
        errorCode: 'UNKNOWN_ERROR',
        message: CLIENT_ERROR_MESSAGES.UNKNOWN_ERROR,
        requestId,
        path: error.config?.url,
        cause: error,
      });
    }

    // No response at all.
    if (isTimeout(error.code, error.message)) {
      return new ApiError({
        statusCode: 408,
        errorCode: 'REQUEST_TIMEOUT',
        message: CLIENT_ERROR_MESSAGES.REQUEST_TIMEOUT,
        requestId,
        path: error.config?.url,
        cause: error,
      });
    }

    return new ApiError({
      statusCode: 0,
      errorCode: 'NETWORK_ERROR',
      message: CLIENT_ERROR_MESSAGES.NETWORK_ERROR,
      requestId,
      path: error.config?.url,
      cause: error,
    });
  }

  return new ApiError({
    statusCode: 0,
    errorCode: 'UNKNOWN_ERROR',
    message: CLIENT_ERROR_MESSAGES.UNKNOWN_ERROR,
    cause: error,
  });
}

/* ------------------------------------------------------- session-ended handling */

type AuthFailureHandler = (error: ApiError) => void;

let authFailureHandler: AuthFailureHandler | null = null;
let hasRedirected = false;

/**
 * Registers what to do when the session ends. The web app wires this to
 * `useAuthStore.getState().clear()` — this package never imports `@repo/store`, so neither
 * package depends on the other.
 */
export function setAuthFailureHandler(handler: AuthFailureHandler | null): void {
  authFailureHandler = handler;
}

/** Routes where a redirect to `/login` would be a loop, or would interrupt an auth flow. */
export const AUTH_ROUTE_SEGMENTS: readonly string[] = [
  '/login',
  '/signup',
  '/logout',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/two-factor',
  '/invite',
];

/**
 * True when the given path already belongs to an auth flow. Matched on path *segments* so a
 * locale prefix (`/ur/login`) and a query string both work, and so `/logins-report` does not.
 */
export function isAuthRoute(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? '';
  return AUTH_ROUTE_SEGMENTS.some(
    (segment) => path === segment || path.endsWith(segment) || path.includes(`${segment}/`),
  );
}

export function isSessionEndedError(error: ApiError): boolean {
  return (
    error.isOneOf(...SESSION_ENDED_ERROR_CODES) ||
    (error.statusCode === 401 && error.errorCode !== 'TWOFA_REQUIRED')
  );
}

/**
 * Clears auth state and redirects to `/login?from=<path>` — **once**, guarded by a module flag, so
 * a burst of parallel queries failing together cannot produce a redirect loop (§6.4). Already
 * being on an auth route suppresses the redirect entirely; `TWOFA_REQUIRED` is excluded because
 * the 2FA challenge is a legitimate 401 mid-login, not a dead session.
 */
export function handleSessionEnded(error: ApiError): void {
  authFailureHandler?.(error);

  if (hasRedirected) return;
  if (typeof window === 'undefined') return;

  const { pathname, search } = window.location;
  if (isAuthRoute(pathname)) return;

  hasRedirected = true;
  const from = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?from=${from}`);
}

/** Test seam: clears the once-only redirect guard and the registered handler. */
export function resetSessionEndedGuard(): void {
  hasRedirected = false;
  authFailureHandler = null;
}

/* ------------------------------------------------------------------- attachment */

export function setupResponseInterceptor(instance: AxiosInstance): number {
  return instance.interceptors.response.use(
    (response) => unwrapEnvelope(response),
    async (rawError: unknown) => {
      const error = normaliseError(rawError);

      // §6.4: a single retry on a stale double-submit token, then give up.
      if (error.isOneOf('CSRF_TOKEN_INVALID', 'CSRF_TOKEN_MISSING') && axios.isAxiosError(rawError)) {
        const config = rawError.config as DrapeRequestConfig | undefined;
        if (config && config.csrfRetried !== true) {
          config.csrfRetried = true;
          await ensureCsrf(true);
          return instance.request(config);
        }
      }

      if (isSessionEndedError(error)) {
        handleSessionEnded(error);
      }

      return Promise.reject(error);
    },
  );
}
