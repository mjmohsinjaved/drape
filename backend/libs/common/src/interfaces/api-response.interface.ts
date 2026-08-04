import type { PaginationMeta } from './pagination.interface';
import type { ErrorCode } from '../constants/error-codes.constant';

/**
 * Field-level validation detail — the `errors[]` array of §2.3.
 * Declared here so the interfaces module is self-contained; `AppException`
 * re-exports the same type from `exceptions/app.exception.ts`.
 */
export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

/**
 * The success envelope — ARCHITECTURE.md §2.3, produced by
 * `ResponseTransformInterceptor`.
 *
 * `meta` is present only for list endpoints, lifted out of the service's
 * `{ items, meta }` return value.
 */
export interface ApiResponse<T> {
  success: true;
  statusCode: number;
  /** Always safe to display to the end user. `@ResponseMessage()` sets it; default `"Success"`. */
  message: string;
  data: T;
  meta?: PaginationMeta;
  /** ISO-8601. */
  timestamp: string;
  path: string;
  /** Mirrors the `X-Request-Id` response header and every log line (E-12). */
  requestId: string;
}

/**
 * The error envelope — ARCHITECTURE.md §2.3, produced by `GlobalExceptionFilter`.
 *
 * `message` is always safe to display. Internal detail goes to the logs, never here.
 * `details` never contains storage keys, another user's identifiers, stack traces or SQL.
 */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  /** Already masked where §2.4 requires it. The true code appears only in the log line. */
  errorCode: ErrorCode;
  message: string;
  /** Reserved for field-level validation. Empty otherwise. */
  errors: FieldError[];
  details?: Record<string, unknown>;
  /** ISO-8601. */
  timestamp: string;
  path: string;
  requestId: string;
}

/** Either envelope. Every `/api/v1/**` response is one of these two shapes. */
export type ApiEnvelope<T> = ApiResponse<T> | ApiErrorResponse;

/**
 * true when a handler already produced an envelope, in which case
 * `ResponseTransformInterceptor` passes it through untouched (§2.3).
 */
export function isEnveloped(value: unknown): value is ApiEnvelope<unknown> {
  return value !== null && typeof value === 'object' && 'success' in value;
}
