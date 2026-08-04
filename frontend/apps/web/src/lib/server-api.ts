import 'server-only';

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

/** The success envelope produced by the API's `ResponseTransformInterceptor` (§2.3). */
interface SuccessEnvelope<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  meta?: PaginationMeta;
  requestId?: string;
}

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
  /** Already user-safe and already through the §9.4 copy check — display it directly. */
  message: string;
  requestId?: string;
  isRetryable: boolean;
}

export type ServerResult<T> =
  | { ok: true; data: T; meta?: PaginationMeta }
  | { ok: false; error: ServerApiFailure };

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
  if (isRecord(error) && isRecord(error.response)) {
    const status = typeof error.response.status === 'number' ? error.response.status : 500;
    const body = error.response.data;
    if (isRecord(body)) {
      return {
        statusCode: status,
        errorCode: typeof body.errorCode === 'string' ? body.errorCode : ErrorCodes.UNKNOWN_ERROR,
        message: typeof body.message === 'string' ? body.message : '',
        requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
        isRetryable: status >= 500 || status === 408 || status === 429,
      };
    }
    return {
      statusCode: status,
      errorCode: ErrorCodes.UNKNOWN_ERROR,
      message: '',
      isRetryable: status >= 500,
    };
  }

  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
  const timedOut = code === 'ECONNABORTED' || code === 'ETIMEDOUT';

  return {
    statusCode: timedOut ? 408 : 0,
    errorCode: timedOut ? ErrorCodes.REQUEST_TIMEOUT : ErrorCodes.NETWORK_ERROR,
    message: '',
    isRetryable: true,
  };
}

/**
 * A GET that never throws. The caller renders the error state instead of blowing up the
 * segment, which is what D-5 asks for: states are rendered, not thrown.
 */
export async function serverGet<T>(
  path: string,
  options: ServerRequestOptions = {},
): Promise<ServerResult<T>> {
  try {
    const client = await createServerApiClient();
    const response = await client.get<SuccessEnvelope<T>>(path, {
      params: options.params,
    });
    const envelope = response.data;
    return envelope.meta
      ? { ok: true, data: envelope.data, meta: envelope.meta }
      : { ok: true, data: envelope.data };
  } catch (error: unknown) {
    return { ok: false, error: toFailure(error) };
  }
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
