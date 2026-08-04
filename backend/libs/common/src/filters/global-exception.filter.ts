import {
  Catch,
  HttpException,
  HttpStatus,
  Optional,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';

import { ERROR_CODE_SPECS, ErrorCode, maskErrorCode } from '../constants/error-codes.constant';
import { METRICS } from '../constants/metrics.constant';
import { AppException, type FieldError } from '../exceptions/app.exception';
import { RequestContext } from '../logger/request-context';
import { StructuredLoggerService } from '../logger/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { redactObject, redactString } from '../utils/redact.util';

import type { ApiErrorResponse } from '../interfaces/api-response.interface';

/** PostgreSQL SQLSTATE codes the filter recognises. */
/** Anything at or above this is ours to answer for, so it logs at `error`. */
const SERVER_ERROR_THRESHOLD = 500;

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_NOT_NULL_VIOLATION = '23502';
const PG_CHECK_VIOLATION = '23514';
const PG_INVALID_TEXT_REPRESENTATION = '22P02';
const PG_STRING_DATA_RIGHT_TRUNCATION = '22001';

/** NestJS built-in HTTP statuses → the closest §2.4 code. */
const STATUS_TO_ERROR_CODE: Readonly<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.AUTH_REQUIRED,
  [HttpStatus.FORBIDDEN]: ErrorCode.INSUFFICIENT_ROLE,
  [HttpStatus.NOT_FOUND]: ErrorCode.RESOURCE_NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.RESOURCE_CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.IMAGE_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.IMAGE_FORMAT_UNSUPPORTED,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMIT_EXCEEDED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: ErrorCode.UPSTREAM_TIMEOUT,
};

interface ErrorRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface ErrorResponse {
  status(code: number): ErrorResponse;
  json(body: unknown): unknown;
  header?(name: string, value: string): unknown;
  setHeader?(name: string, value: string): unknown;
  headersSent?: boolean;
}

/** What a resolved exception collapses to before it is serialised. */
interface ResolvedError {
  /** The code the client sees, after masking. */
  errorCode: ErrorCode;
  /** The code that was actually thrown. Logged; never serialised when it differs. */
  trueErrorCode: ErrorCode;
  status: number;
  message: string;
  errors: FieldError[];
  details?: Record<string, unknown>;
  /** Server-side only. */
  logMessage: string;
  stack?: string;
  /** `error` for 5xx, `warn` for 4xx. */
  level: 'warn' | 'error';
}

/**
 * The error envelope — ARCHITECTURE.md §2.3 / §2.5.
 *
 * Maps `AppException`, NestJS `HttpException`, TypeORM `QueryFailedError` and
 * anything else onto the §2.3 error shape.
 *
 * ### What never reaches the client
 *
 * A stack trace, a SQL statement, a driver message, a constraint name, or the
 * message of an unrecognised exception. Those go to the log line, once, with the
 * request id, so an operator can correlate a support ticket to the real cause.
 * `message` on the wire always comes from `ERROR_CODE_SPECS` or from an explicitly
 * user-safe override on an `AppException`.
 *
 * ### Masking
 *
 * `MASKED_ERROR_CODES` is applied here: `PHOTO_NOT_OWNED` is logged as itself and
 * returned as `PHOTO_NOT_FOUND` (404), so a cross-account probe cannot distinguish
 * "not yours" from "does not exist" (S-9, §9.2).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger: StructuredLoggerService;

  constructor(
    @Optional() private readonly metrics?: MetricsService,
    @Optional() logger?: StructuredLoggerService,
  ) {
    this.logger = logger ?? new StructuredLoggerService({ context: 'GlobalExceptionFilter' });
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<string>() !== 'http') {
      // Nothing to serialise for a non-HTTP context; log and let it propagate.
      this.logger.error('Non-HTTP exception', { stack: extractStack(exception) });
      return;
    }

    const request = host.switchToHttp().getRequest<ErrorRequest>();
    const response = host.switchToHttp().getResponse<ErrorResponse>();

    const resolved = this.resolve(exception);
    const store = RequestContext.get();
    const requestId = store?.traceId ?? readRequestIdHeader(request) ?? '';
    const path = request.originalUrl ?? request.url ?? '';
    const method = (request.method ?? 'UNKNOWN').toUpperCase();

    // ── Server-side log: the full truth, redacted of personal data (E-12) ────
    const logPayload: Record<string, unknown> = {
      requestId,
      userId: store?.userId,
      errorCode: resolved.errorCode,
      trueErrorCode: resolved.trueErrorCode,
      statusCode: resolved.status,
      path: stripQuery(path),
      method,
      durationMs: store === undefined ? undefined : Date.now() - store.startedAt,
      detail: resolved.logMessage,
      details: redactObject(resolved.details),
    };
    if (resolved.stack !== undefined) {
      logPayload.stack = redactString(resolved.stack);
    }

    if (resolved.level === 'error') {
      this.logger.error(`${method} ${stripQuery(path)} → ${resolved.trueErrorCode}`, logPayload);
    } else {
      this.logger.warn(`${method} ${stripQuery(path)} → ${resolved.trueErrorCode}`, logPayload);
    }

    // ── Metrics (E-13) ──────────────────────────────────────────────────────
    this.metrics?.increment(METRICS.ERRORS_BY_CODE, {
      errorCode: resolved.trueErrorCode,
      status: resolved.status,
      masked: resolved.errorCode !== resolved.trueErrorCode,
    });
    if (resolved.trueErrorCode === ErrorCode.INTERNAL_ERROR) {
      this.metrics?.increment(METRICS.ERRORS_UNHANDLED, {
        exception: exception instanceof Error ? exception.name : typeof exception,
      });
    }

    if (response.headersSent === true) {
      // The stream has already started (a file download that failed mid-flight).
      // Anything written now would corrupt the body.
      return;
    }

    // ── Client-safe envelope (§2.3) ─────────────────────────────────────────
    const retryAfterSeconds = resolved.details?.retryAfterSeconds;
    if (typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) {
      setHeader(response, 'Retry-After', String(Math.ceil(retryAfterSeconds)));
    }

    const body: ApiErrorResponse = {
      success: false,
      statusCode: resolved.status,
      errorCode: resolved.errorCode,
      message: resolved.message,
      errors: resolved.errors,
      details: resolved.details,
      timestamp: new Date().toISOString(),
      path,
      requestId,
    };

    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof AppException) {
      return this.fromAppException(exception);
    }
    if (isQueryFailedError(exception)) {
      return this.fromQueryFailedError(exception);
    }
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    return this.fromUnknown(exception);
  }

  private fromAppException(exception: AppException): ResolvedError {
    const trueErrorCode = exception.errorCode;
    const errorCode = maskErrorCode(trueErrorCode);
    const spec = ERROR_CODE_SPECS[errorCode];
    const masked = errorCode !== trueErrorCode;

    return {
      errorCode,
      trueErrorCode,
      status: spec.status,
      // A masked code must not leak the overridden message of the true code either.
      message: masked ? spec.message : exception.message,
      errors: masked ? [] : exception.errors,
      details: masked ? undefined : exception.details,
      logMessage: exception.message,
      stack: exception.stack,
      level: spec.status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : 'warn',
    };
  }

  private fromQueryFailedError(exception: QueryFailedErrorLike): ResolvedError {
    const sqlState = exception.driverError?.code ?? exception.code;
    const errorCode = mapSqlState(sqlState);
    const spec = ERROR_CODE_SPECS[errorCode];

    return {
      errorCode,
      trueErrorCode: errorCode,
      status: spec.status,
      // Never the driver message and never the SQL — both name columns, constraints
      // and sometimes the offending value.
      message: spec.message,
      errors: [],
      details: undefined,
      logMessage: `QueryFailedError sqlState=${sqlState ?? 'unknown'} constraint=${
        exception.driverError?.constraint ?? 'unknown'
      }`,
      stack: exception.stack,
      level:
        errorCode === ErrorCode.INTERNAL_ERROR
          ? 'error'
          : spec.status >= HttpStatus.INTERNAL_SERVER_ERROR
            ? 'error'
            : 'warn',
    };
  }

  private fromHttpException(exception: HttpException): ResolvedError {
    const status = exception.getStatus();
    const errorCode = STATUS_TO_ERROR_CODE[status] ?? ErrorCode.INTERNAL_ERROR;
    const spec = ERROR_CODE_SPECS[errorCode];

    return {
      errorCode,
      trueErrorCode: errorCode,
      // Honour the thrown status even when the mapped code's canonical status
      // differs (e.g. a 405 that maps to INTERNAL_ERROR must not become a 500).
      status: errorCode === ErrorCode.INTERNAL_ERROR ? status : spec.status,
      // NestJS's own message ("Cannot POST /api/v1/foo", "Unexpected token in JSON")
      // is diagnostic, not user copy. Always use the §2.4 string.
      message: spec.message,
      errors: [],
      details: undefined,
      logMessage: exception.message,
      stack: exception.stack,
      // `getStatus()` returns a plain number, so this compares against the
      // numeric threshold rather than the enum member — mixing the two is what
      // `no-unsafe-enum-comparison` exists to catch.
      level: status >= SERVER_ERROR_THRESHOLD ? 'error' : 'warn',
    };
  }

  private fromUnknown(exception: unknown): ResolvedError {
    const spec = ERROR_CODE_SPECS[ErrorCode.INTERNAL_ERROR];
    return {
      errorCode: ErrorCode.INTERNAL_ERROR,
      trueErrorCode: ErrorCode.INTERNAL_ERROR,
      status: spec.status,
      message: spec.message,
      errors: [],
      details: undefined,
      logMessage:
        exception instanceof Error
          ? `${exception.name}: ${exception.message}`
          : `Non-Error thrown: ${safeDescribe(exception)}`,
      stack: extractStack(exception),
      level: 'error',
    };
  }
}

/**
 * Structural match for TypeORM's `QueryFailedError`.
 *
 * `instanceof` would make `libs/common` depend on `typeorm`, which the §1.1 layering
 * forbids for a library that knows nothing about persistence. The shape is stable
 * across TypeORM 0.3.x.
 */
interface QueryFailedErrorLike extends Error {
  query?: string;
  parameters?: unknown[];
  code?: string;
  driverError?: { code?: string; constraint?: string; detail?: string; table?: string };
}

function isQueryFailedError(value: unknown): value is QueryFailedErrorLike {
  if (!(value instanceof Error)) {
    return false;
  }
  if (value.name === 'QueryFailedError') {
    return true;
  }
  const candidate = value as QueryFailedErrorLike;
  return typeof candidate.query === 'string' && candidate.driverError !== undefined;
}

/** SQLSTATE → §2.4 code. Anything unrecognised is an internal error, not a leak. */
function mapSqlState(sqlState: string | undefined): ErrorCode {
  switch (sqlState) {
    case PG_UNIQUE_VIOLATION:
      // A duplicate key is a conflict the caller can act on: reload and retry.
      // The constraint name identifies the column, so it stays in the log only.
      return ErrorCode.RESOURCE_CONFLICT;
    case PG_FOREIGN_KEY_VIOLATION:
      return ErrorCode.RESOURCE_CONFLICT;
    case PG_NOT_NULL_VIOLATION:
    case PG_CHECK_VIOLATION:
    case PG_INVALID_TEXT_REPRESENTATION:
    case PG_STRING_DATA_RIGHT_TRUNCATION:
      return ErrorCode.VALIDATION_ERROR;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

function extractStack(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined;
}

function safeDescribe(value: unknown): string {
  if (typeof value === 'string') {
    return redactString(value);
  }
  try {
    return redactString(JSON.stringify(value) ?? String(value));
  } catch {
    return typeof value;
  }
}

function setHeader(response: ErrorResponse, name: string, value: string): void {
  if (typeof response.header === 'function') {
    response.header(name, value);
  } else if (typeof response.setHeader === 'function') {
    response.setHeader(name, value);
  }
}

function readRequestIdHeader(request: ErrorRequest): string | undefined {
  const value = request.headers?.['x-request-id'];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.length > 0 ? single : undefined;
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
