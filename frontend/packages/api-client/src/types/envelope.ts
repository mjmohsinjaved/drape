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

/**
 * §2.3 — error. `message` carries no internal detail: no stack, no SQL, no storage key. It is
 * **not** display copy — see the note on {@link ApiError.message}.
 */
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

/* ================================================================== *
 * Classification — one answer per question, for every feature
 * ================================================================== */

/**
 * Codes where re-sending the identical request is a dead end, whatever the status said.
 *
 * §10.3 rules out an affordance that cannot help: a "Try again" on `QUOTA_EXHAUSTED` is a dead
 * end wearing a button. This is the union of the two denylists that used to live in
 * `features/auth` and `features/tryon`, and it acts as a **veto** — it can only ever turn a
 * retry off, never on.
 */
export const NON_RETRYABLE_ERROR_CODES: readonly string[] = [
  // Allowance and budget — the number does not change by asking again.
  'QUOTA_EXHAUSTED',
  'BUDGET_EXHAUSTED',
  // Guard-chain refusals with a specific next screen (§8.1 step 3).
  'CONSENT_REQUIRED',
  'CONSENT_STALE',
  'EMAIL_NOT_VERIFIED',
  'PHONE_NOT_VERIFIED',
  'TEST_RENDER_REQUIRED',
  // Identity and authorisation — a different screen, never a retry.
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
  'INSUFFICIENT_ROLE',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'TWOFA_REQUIRED_FOR_ROLE',
  'DELETION_IN_PROGRESS',
  'IP_BLOCKED',
  // The thing is not there. Asking again does not create it.
  'GARMENT_NOT_FOUND',
  'GARMENT_NOT_PUBLISHED',
  'RESULT_NOT_FOUND',
  'JOB_NOT_FOUND',
  'PHOTO_NOT_FOUND',
  'PHOTO_LIMIT_REACHED',
  // A moderation refusal needs a different photograph, not the same one again.
  'MODERATION_REJECTED',
  'PHOTO_BLOCKED_BY_MODERATION',
];

const nonRetryableCodes: ReadonlySet<string> = new Set(NON_RETRYABLE_ERROR_CODES);

/**
 * ═══ The D-5 permission-denied state ═══
 *
 * "Your account may not do this", as distinct from "we do not know who you are".
 *
 * These five all mean the same thing to the person reading the screen: *signing in again will
 * not change the answer.* They get the S-9 treatment — plain language, a way back, no status
 * code, and nothing that reveals whether the resource exists.
 *
 * **`AUTH_REQUIRED`, `SESSION_EXPIRED` and `SESSION_INVALID` are deliberately not here.** They
 * are authentication failures: the API does not know who is asking, and the honest screen is
 * one with a sign-in action, not a dead end telling her she has no access to something that is
 * in fact hers. See {@link AUTHENTICATION_REQUIRED_ERROR_CODES}. The two feature-local copies of
 * this list disagreed on exactly these three, so the same dropped session showed a "no access"
 * screen in the fitting room and an inline "sign in to continue" on an account form.
 */
export const PERMISSION_DENIED_ERROR_CODES: readonly string[] = [
  /** The session is valid; the role is not sufficient. */
  'INSUFFICIENT_ROLE',
  /** A-19 — the account is on hold. */
  'ACCOUNT_SUSPENDED',
  /** The account has been closed. */
  'ACCOUNT_DEACTIVATED',
  /** S-8 — an admin without a second factor may not proceed, and re-authenticating changes nothing. */
  'TWOFA_REQUIRED_FOR_ROLE',
  /** The erasure is running; nothing on this account may be touched again. */
  'DELETION_IN_PROGRESS',
];

const permissionDeniedCodes: ReadonlySet<string> = new Set(PERMISSION_DENIED_ERROR_CODES);

/**
 * ═══ Authentication, not authorisation ═══
 *
 * The API cannot tell who is asking. The screen that helps offers a way back in and returns her
 * to where she was; it never says she lacks permission, because she may well have it.
 */
export const AUTHENTICATION_REQUIRED_ERROR_CODES: readonly string[] = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
];

const authenticationRequiredCodes: ReadonlySet<string> = new Set(
  AUTHENTICATION_REQUIRED_ERROR_CODES,
);

/** True when `code` should render the D-5 permission-denied state (S-9). */
export function isPermissionDenied(code: string): boolean {
  return permissionDeniedCodes.has(code);
}

/** True when `code` means the session is gone and the next step is signing in. */
export function isAuthenticationRequired(code: string): boolean {
  return authenticationRequiredCodes.has(code);
}

/**
 * True when offering the same thing again is honest — the single retry rule for the whole app.
 *
 * ═══ Why `statusCode` is optional ═══
 *
 * There are two shapes of retry in this product, and they are not the same question:
 *
 * - **Re-running a read.** `ScreenError`'s button is `router.refresh()`. Re-reading is free and
 *   idempotent, and much of the copy explicitly tells her to reload (`RESOURCE_CONFLICT`:
 *   "Reload to see the current order"). So a read offers the retry unless the code is a *known*
 *   dead end. Call this **without** a status.
 * - **Re-sending a mutation.** A POST that may have partially applied must not be re-offered on
 *   a guess. So a mutation additionally requires the failure to be transport- or server-shaped.
 *   Call this **with** the status — which is what `ApiError.isRetryable` does.
 *
 * The dead-end veto (step 1) is common to both, and is the part that used to exist twice.
 *
 * The SSE `failed` frame on the try-on stream is the third caller: it arrives as a bare code
 * with no HTTP response at all, and takes the read branch for the same reason — the failure was
 * not attributed to anything the client can fix by changing its request.
 */
export function isRetryableCode(code: string, statusCode?: number): boolean {
  // 1. A known dead end is never retryable, whatever the status was (§10.3).
  if (nonRetryableCodes.has(code)) return false;
  // 2. The request never got an answer, or the answer never arrived in time.
  if (code === 'NETWORK_ERROR' || code === 'REQUEST_TIMEOUT') return true;
  // 3. The caller walked away; there is nothing to offer.
  if (code === 'REQUEST_ABORTED') return false;
  // 4. No status supplied — the read / SSE branch above.
  if (statusCode === undefined) return true;
  // 5. The status classes where re-sending the identical request can plausibly succeed.
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The one narrowing point from "something failed" to "which code was it".
 *
 * Accepts everything a component can be handed: an {@link ApiError} (the browser path), the
 * plain failure object a Server Component read produces, a bare code string (the SSE `failed`
 * frame), and anything else at all — which is `UNKNOWN_ERROR`, so callers never handle
 * `undefined`.
 */
export function resolveErrorCode(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof ApiError) return error.errorCode;
  if (isRecord(error) && typeof error.errorCode === 'string') return error.errorCode;
  return 'UNKNOWN_ERROR';
}

/** The HTTP status behind a failure, when there was one. */
export function resolveStatusCode(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.statusCode;
  if (isRecord(error) && typeof error.statusCode === 'number') return error.statusCode;
  return undefined;
}

/**
 * Every rejection reaching application code is an `ApiError` — never a raw `AxiosError` (§6.4).
 *
 * ═══ `message` is a diagnostic, not display copy ═══
 *
 * This class used to promise that `message` was "already user-safe … the UI displays it
 * directly". No feature ever did, and they were right not to: the server's message is
 * **English only**, and Drape ships `en` and `ur` (C-41, §6.7). Rendering it would put an
 * English sentence in the middle of an Urdu screen at the worst possible moment.
 *
 * So the contract is: `message` is safe to *log* and safe to show a developer. **Copy on screen
 * is selected by {@link errorCode}** through `useErrorCopy(namespace)`, which resolves the code
 * against the screen's own translated `errors.*` table. `requestId` is not shown either — it is
 * a support correlation id, not something the reader can act on.
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
   * request again can plausibly succeed — **unless** the code is a known dead end
   * ({@link NON_RETRYABLE_ERROR_CODES}). Drives the "Try again" affordance in the D-5 error state.
   *
   * The dead-end veto is what stops a 429 `QUOTA_EXHAUSTED` from getting a retry button that
   * cannot possibly help (§10.3).
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
    this.isRetryable = isRetryableCode(init.errorCode, init.statusCode);

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

  /**
   * True when this failure renders the D-5 permission-denied state rather than an error state.
   * One answer for every feature — see {@link PERMISSION_DENIED_ERROR_CODES}.
   */
  get isPermissionDenied(): boolean {
    return isPermissionDenied(this.errorCode);
  }

  /** True when the session is gone and the next step is signing in, not a retry and not a 403. */
  get isAuthenticationRequired(): boolean {
    return isAuthenticationRequired(this.errorCode);
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
