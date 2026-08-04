/**
 * The ARCHITECTURE.md §2.3 response envelope, and the single error type application code ever
 * sees.
 *
 * Every response on `/api/v1/**` uses one of the three shapes below. The only bare bodies in the
 * whole API are `GET /api/v1/files/:token` (binary stream) and
 * `GET /api/v1/tryon/jobs/:jobId/stream` (SSE) — neither goes through axios.
 */

import { type ApiErrorCode, isClientErrorCode, isErrorCode } from './error-codes';

/** §2.3 — field-level validation detail. Populated only by `VALIDATION_ERROR`. */
export interface FieldError {
  field: string;
  message: string;
  code: string;
}

/** §2.8 — the pagination block the envelope carries alongside a list `data`. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: string;
  sortOrder: SortOrder;
}

export type SortOrder = 'ASC' | 'DESC';

/** §2.3 — success, single resource. */
export interface ApiResponse<TData> {
  success: true;
  statusCode: number;
  message: string;
  data: TData;
  /** Present only on list endpoints. */
  meta?: PaginationMeta;
  timestamp: string;
  path: string;
  /** Mirrors the `X-Request-Id` response header and every log line for the request (E-12). */
  requestId: string;
}

/** §2.3 — success, paginated list. `data` is the array; the envelope carries `meta`. */
export interface PaginatedResponse<TItem> extends ApiResponse<TItem[]> {
  meta: PaginationMeta;
}

/**
 * What a list query resolves to once {@link unwrapEnvelope} has lifted `meta` out of the envelope.
 * Kept separate from {@link PaginatedResponse} so nothing downstream handles the transport shape.
 */
export interface Paginated<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}

/** §2.3 — error. `message` is always safe to display; internal detail goes to logs, never here. */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  errorCode: string;
  message: string;
  errors: FieldError[];
  /**
   * A typed, non-sensitive object the UI needs in order to render the state correctly — quota
   * numbers, `retryAfterSeconds`, failing bulk item ids. Never storage keys, another user's
   * identifiers, stack traces or SQL.
   */
  details?: Record<string, unknown>;
  timestamp: string;
  path: string;
  requestId: string;
}

export interface ApiErrorInit {
  statusCode: number;
  errorCode: string;
  message: string;
  errors?: FieldError[];
  details?: Record<string, unknown>;
  requestId?: string;
  path?: string;
  cause?: unknown;
}

/**
 * Every rejection reaching application code is an `ApiError` — never a raw `AxiosError` (§6.4).
 *
 * `message` is the server's message: already user-safe, already through the PRD §9.4 shortlisting
 * check and the §10.5 copy standards. **The UI displays it directly rather than inventing its
 * own copy.** The two client-synthesised codes (`NETWORK_ERROR`, `REQUEST_TIMEOUT`) are the only
 * ones whose copy is translated locally.
 */
export class ApiError extends Error {
  /** HTTP status. `0` when the request never reached the API. */
  readonly statusCode: number;

  /** An §2.4 `ErrorCode` value, or one of `NETWORK_ERROR` / `REQUEST_TIMEOUT` / `REQUEST_ABORTED` / `UNKNOWN_ERROR`. */
  readonly errorCode: string;

  readonly errors: FieldError[];

  readonly details?: Record<string, unknown>;

  /** Mirrors the `X-Request-Id` header. Quote this to support and the log line is findable (E-12). */
  readonly requestId?: string;

  /** Alias of {@link requestId}, kept because the envelope's correlation id is called a trace id in some client-side specs. */
  readonly traceId?: string;

  readonly path?: string;

  /**
   * True for 5xx, 408, 429 and network failures — the classes of failure where trying the same
   * request again can plausibly succeed. Drives the "Try again" affordance in the D-5 error state.
   *
   * Note this is **not** the query-retry predicate: automatic retries additionally refuse every
   * 4xx, including 408 and 429. See `shouldRetryRequest` in `query-client.ts`.
   */
  readonly isRetryable: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiError';
    this.statusCode = init.statusCode;
    this.errorCode = init.errorCode;
    this.errors = init.errors ?? [];
    this.details = init.details;
    this.requestId = init.requestId;
    this.traceId = init.requestId;
    this.path = init.path;
    this.isRetryable = computeIsRetryable(init.statusCode, init.errorCode);

    // Restores the prototype chain so `instanceof ApiError` survives a down-levelled build.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  is(code: ApiErrorCode): boolean {
    return this.errorCode === code;
  }

  isOneOf(...codes: ApiErrorCode[]): boolean {
    return codes.some((code) => code === this.errorCode);
  }

  /** True when the code is one this client knows about — false for a code added server-side since. */
  get isKnownCode(): boolean {
    return isErrorCode(this.errorCode) || isClientErrorCode(this.errorCode);
  }

  /** The `details.retryAfterSeconds` the API attaches to `RATE_LIMIT_EXCEEDED` / `ACCOUNT_LOCKED`. */
  get retryAfterSeconds(): number | undefined {
    const value = this.details?.retryAfterSeconds;
    return typeof value === 'number' ? value : undefined;
  }

  /** The first message for a given field, for inline form errors. */
  fieldError(field: string): string | undefined {
    return this.errors.find((entry) => entry.field === field)?.message;
  }
}

function computeIsRetryable(statusCode: number, errorCode: string): boolean {
  if (errorCode === 'NETWORK_ERROR' || errorCode === 'REQUEST_TIMEOUT') return true;
  if (errorCode === 'REQUEST_ABORTED') return false;
  if (statusCode === 408 || statusCode === 429) return true;
  return statusCode >= 500;
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** True when a parsed body looks like the §2.3 success envelope. */
export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success: unknown }).success === true &&
    'data' in value
  );
}

/** True when a parsed body looks like the §2.3 error envelope. */
export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success: unknown }).success === false &&
    'errorCode' in value
  );
}
