import { HttpException } from '@nestjs/common';

import { ERROR_CODE_SPECS, type ErrorCode } from '../constants/error-codes.constant';

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export interface AppExceptionOptions {
  /** Overrides the default message from ERROR_CODE_SPECS. Must still be user-safe. */
  message?: string;
  /** Field-level validation detail. */
  errors?: FieldError[];
  /** Typed, non-sensitive data the UI needs to render the state. */
  details?: Record<string, unknown>;
  /** Attached to the log line only. Never serialised to the client. */
  cause?: unknown;
}

/** The payload `HttpException` carries for every `AppException`. */
export interface AppExceptionPayload {
  errorCode: ErrorCode;
  message: string;
  errors: FieldError[];
  details?: Record<string, unknown>;
}

/**
 * Base application exception — ARCHITECTURE.md §2.5.
 *
 * The status always comes from `ERROR_CODE_SPECS`; a throw site can override the
 * message (to interpolate `{from}`/`{max}` placeholders) but never the status.
 */
export class AppException extends HttpException {
  readonly errorCode: ErrorCode;
  readonly errors: FieldError[];
  readonly details?: Record<string, unknown>;

  constructor(errorCode: ErrorCode, options: AppExceptionOptions = {}) {
    const spec = ERROR_CODE_SPECS[errorCode];
    const message = options.message ?? spec.message;
    super(
      { errorCode, message, errors: options.errors ?? [], details: options.details },
      spec.status,
      { cause: options.cause },
    );
    this.errorCode = errorCode;
    this.errors = options.errors ?? [];
    this.details = options.details;
  }

  /** The typed payload, without the `unknown` widening `getResponse()` returns. */
  getAppPayload(): AppExceptionPayload {
    return {
      errorCode: this.errorCode,
      message: this.message,
      errors: this.errors,
      details: this.details,
    };
  }
}

/** true when `value` is an `AppException`. Safe across module boundaries. */
export function isAppException(value: unknown): value is AppException {
  return value instanceof AppException;
}
