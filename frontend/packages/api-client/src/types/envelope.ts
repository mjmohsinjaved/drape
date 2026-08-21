import { type ApiErrorCode, isClientErrorCode, isErrorCode } from './error-codes';

export interface FieldError {
  field: string;
  message: string;
  code: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: string;
  sortOrder: SortOrder;
}

export type SortOrder = 'ASC' | 'DESC';

export interface ApiResponse<TData> {
  success: true;
  statusCode: number;
  message: string;
  data: TData;
  meta?: PaginationMeta;
  timestamp: string;
  path: string;
  requestId: string;
}

export interface PaginatedResponse<TItem> extends ApiResponse<TItem[]> {
  meta: PaginationMeta;
}

export interface Paginated<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  errorCode: string;
  message: string;
  errors: FieldError[];
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

export const NON_RETRYABLE_ERROR_CODES: readonly string[] = [
  'QUOTA_EXHAUSTED',
  'BUDGET_EXHAUSTED',
  'CONSENT_REQUIRED',
  'CONSENT_STALE',
  'EMAIL_NOT_VERIFIED',
  'PHONE_NOT_VERIFIED',
  'TEST_RENDER_REQUIRED',
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
  'INSUFFICIENT_ROLE',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'DELETION_IN_PROGRESS',
  'IP_BLOCKED',
  'GARMENT_NOT_FOUND',
  'GARMENT_NOT_PUBLISHED',
  'RESULT_NOT_FOUND',
  'JOB_NOT_FOUND',
  'PHOTO_NOT_FOUND',
  'PHOTO_LIMIT_REACHED',
  'MODERATION_REJECTED',
  'PHOTO_BLOCKED_BY_MODERATION',
];

const nonRetryableCodes: ReadonlySet<string> = new Set(NON_RETRYABLE_ERROR_CODES);

export const PERMISSION_DENIED_ERROR_CODES: readonly string[] = [
  'INSUFFICIENT_ROLE',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'DELETION_IN_PROGRESS',
];

const permissionDeniedCodes: ReadonlySet<string> = new Set(PERMISSION_DENIED_ERROR_CODES);

export const ACCOUNT_STATUS_ERROR_CODES: readonly string[] = [
  'ACCOUNT_PENDING_APPROVAL',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
];

const accountStatusCodes: ReadonlySet<string> = new Set(ACCOUNT_STATUS_ERROR_CODES);

export const AUTHENTICATION_REQUIRED_ERROR_CODES: readonly string[] = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
];

const authenticationRequiredCodes: ReadonlySet<string> = new Set(
  AUTHENTICATION_REQUIRED_ERROR_CODES,
);

export function isPermissionDenied(code: string): boolean {
  return permissionDeniedCodes.has(code);
}

export function isAccountBlocked(code: string): boolean {
  return accountStatusCodes.has(code);
}

export function isAuthenticationRequired(code: string): boolean {
  return authenticationRequiredCodes.has(code);
}

export function isRetryableCode(code: string, statusCode?: number): boolean {
  if (nonRetryableCodes.has(code)) return false;
  if (code === 'NETWORK_ERROR' || code === 'REQUEST_TIMEOUT') return true;
  if (code === 'REQUEST_ABORTED') return false;
  if (statusCode === undefined) return true;
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function resolveErrorCode(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof ApiError) return error.errorCode;
  if (isRecord(error) && typeof error.errorCode === 'string') return error.errorCode;
  return 'UNKNOWN_ERROR';
}

export function resolveStatusCode(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.statusCode;
  if (isRecord(error) && typeof error.statusCode === 'number') return error.statusCode;
  return undefined;
}

export class ApiError extends Error {
  readonly statusCode: number;

  readonly errorCode: string;

  readonly errors: FieldError[];

  readonly details?: Record<string, unknown>;

  readonly requestId?: string;

  readonly traceId?: string;

  readonly path?: string;

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

    Object.setPrototypeOf(this, ApiError.prototype);
  }

  is(code: ApiErrorCode): boolean {
    return this.errorCode === code;
  }

  isOneOf(...codes: ApiErrorCode[]): boolean {
    return codes.some((code) => code === this.errorCode);
  }

  get isKnownCode(): boolean {
    return isErrorCode(this.errorCode) || isClientErrorCode(this.errorCode);
  }

  get isPermissionDenied(): boolean {
    return isPermissionDenied(this.errorCode);
  }

  get isAccountBlocked(): boolean {
    return isAccountBlocked(this.errorCode);
  }

  get isAuthenticationRequired(): boolean {
    return isAuthenticationRequired(this.errorCode);
  }

  get retryAfterSeconds(): number | undefined {
    const value = this.details?.retryAfterSeconds;
    return typeof value === 'number' ? value : undefined;
  }

  fieldError(field: string): string | undefined {
    return this.errors.find((entry) => entry.field === field)?.message;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success: unknown }).success === true &&
    'data' in value
  );
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success: unknown }).success === false &&
    'errorCode' in value
  );
}
