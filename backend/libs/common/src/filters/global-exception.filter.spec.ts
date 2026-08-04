import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException as NestNotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';

import { ERROR_CODE_SPECS, ErrorCode } from '../constants/error-codes.constant';
import { METRICS } from '../constants/metrics.constant';
import { AppException } from '../exceptions/app.exception';
import { OwnershipException, QuotaException } from '../exceptions/guard-chain.exception';
import { RequestContext } from '../logger/request-context';
import { StructuredLoggerService } from '../logger/structured-logger.service';
import { MetricsService } from '../metrics/metrics.service';

import { GlobalExceptionFilter } from './global-exception.filter';

import type { ApiErrorResponse } from '../interfaces/api-response.interface';
import type { LogWriter } from '../logger/structured-logger.service';

const TRACE_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';

interface Harness {
  filter: GlobalExceptionFilter;
  host: ArgumentsHost;
  body(): ApiErrorResponse;
  status(): number;
  headers: Record<string, string>;
  logs(): Array<Record<string, unknown>>;
  metrics: MetricsService;
}

function createHarness(options: { url?: string; headersSent?: boolean } = {}): Harness {
  let capturedStatus = 0;
  let capturedBody: unknown;
  const headers: Record<string, string> = {};
  const lines: string[] = [];

  const writer: LogWriter = { write: (line) => void lines.push(line) };
  const logger = new StructuredLoggerService({ writer, level: 'debug', context: 'Test' });
  const metrics = new MetricsService();

  const response = {
    headersSent: options.headersSent ?? false,
    status(code: number) {
      capturedStatus = code;
      return this;
    },
    json(value: unknown) {
      capturedBody = value;
      return value;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };

  const request = {
    method: 'POST',
    originalUrl: options.url ?? '/api/v1/tryon?debug=1',
    url: options.url ?? '/api/v1/tryon?debug=1',
    headers: {} as Record<string, string>,
  };

  const host = {
    getType: <T>(): T => 'http' as unknown as T,
    switchToHttp: () => ({
      getRequest: <T>(): T => request as unknown as T,
      getResponse: <T>(): T => response as unknown as T,
    }),
  } as unknown as ArgumentsHost;

  return {
    filter: new GlobalExceptionFilter(metrics, logger),
    host,
    body: () => capturedBody as ApiErrorResponse,
    status: () => capturedStatus,
    headers,
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    metrics,
  };
}

function runFilter(harness: Harness, exception: unknown): void {
  RequestContext.run({ traceId: TRACE_ID, startedAt: Date.now() }, () => {
    harness.filter.catch(exception, harness.host);
  });
}

describe('GlobalExceptionFilter — AppException', () => {
  it('renders the §2.3 error envelope', () => {
    const harness = createHarness();
    runFilter(
      harness,
      new QuotaException(ErrorCode.QUOTA_EXHAUSTED, {
        details: { period: '2026-08', limit: 15, used: 15 },
      }),
    );

    const body = harness.body();
    expect(harness.status()).toBe(403);
    expect(body).toMatchObject({
      success: false,
      statusCode: 403,
      errorCode: ErrorCode.QUOTA_EXHAUSTED,
      message: ERROR_CODE_SPECS[ErrorCode.QUOTA_EXHAUSTED].message,
      errors: [],
      details: { period: '2026-08', limit: 15, used: 15 },
      path: '/api/v1/tryon?debug=1',
      requestId: TRACE_ID,
    });
  });

  it('takes the status from ERROR_CODE_SPECS, never from the throw site', () => {
    const harness = createHarness();
    runFilter(harness, new AppException(ErrorCode.TOKEN_EXPIRED));
    expect(harness.status()).toBe(410);
  });

  it('keeps an explicit user-safe message override', () => {
    const harness = createHarness();
    runFilter(
      harness,
      new AppException(ErrorCode.INVALID_PUBLISH_TRANSITION, {
        message: "A piece can't move from ARCHIVED to PUBLISHED.",
      }),
    );
    expect(harness.body().message).toBe("A piece can't move from ARCHIVED to PUBLISHED.");
  });

  it('passes field errors through for VALIDATION_ERROR', () => {
    const harness = createHarness();
    runFilter(
      harness,
      new AppException(ErrorCode.VALIDATION_ERROR, {
        errors: [{ field: 'email', message: 'email must be an email', code: 'IS_EMAIL' }],
      }),
    );
    expect(harness.body().errors).toEqual([
      { field: 'email', message: 'email must be an email', code: 'IS_EMAIL' },
    ]);
  });

  it('sets Retry-After when details carry retryAfterSeconds', () => {
    const harness = createHarness();
    runFilter(
      harness,
      new AppException(ErrorCode.RATE_LIMIT_EXCEEDED, { details: { retryAfterSeconds: 42.2 } }),
    );
    expect(harness.headers['Retry-After']).toBe('43');
    expect(harness.status()).toBe(429);
  });
});

describe('GlobalExceptionFilter — masking (§2.4, S-9)', () => {
  it('returns the masked code and a 404 to the client', () => {
    const harness = createHarness();
    runFilter(harness, new OwnershipException(ErrorCode.PHOTO_NOT_OWNED));

    expect(harness.status()).toBe(404);
    expect(harness.body().errorCode).toBe(ErrorCode.PHOTO_NOT_FOUND);
    expect(harness.body().message).toBe(ERROR_CODE_SPECS[ErrorCode.PHOTO_NOT_FOUND].message);
  });

  it('logs the true code alongside the request id, so E-7 can assert on it', () => {
    const harness = createHarness();
    runFilter(harness, new OwnershipException(ErrorCode.RESULT_NOT_OWNED));

    const line = harness.logs().at(-1) ?? {};
    expect(line.trueErrorCode).toBe(ErrorCode.RESULT_NOT_OWNED);
    expect(line.errorCode).toBe(ErrorCode.RESULT_NOT_FOUND);
    expect(line.traceId).toBe(TRACE_ID);
  });

  it('drops details and errors on a masked response, so nothing leaks sideways', () => {
    const harness = createHarness();
    runFilter(
      harness,
      new OwnershipException(ErrorCode.SHARE_LINK_NOT_OWNED, {
        details: { ownerUserId: 'someone-else' },
        errors: [{ field: 'id', message: 'nope' }],
      }),
    );

    expect(harness.body().details).toBeUndefined();
    expect(harness.body().errors).toEqual([]);
    expect(JSON.stringify(harness.body())).not.toContain('someone-else');
  });
});

describe('GlobalExceptionFilter — TypeORM QueryFailedError', () => {
  function queryFailedError(code: string, constraint: string): Error {
    const error = new Error('duplicate key value violates unique constraint');
    error.name = 'QueryFailedError';
    Object.assign(error, {
      query: 'INSERT INTO garments ("sku") VALUES ($1)',
      parameters: ['ZR-001'],
      driverError: { code, constraint, detail: 'Key (sku)=(ZR-001) already exists.' },
    });
    return error;
  }

  it('maps a unique violation to a 409 conflict', () => {
    const harness = createHarness();
    runFilter(harness, queryFailedError('23505', 'UQ_garments_sku'));

    expect(harness.status()).toBe(HttpStatus.CONFLICT);
    expect(harness.body().errorCode).toBe(ErrorCode.RESOURCE_CONFLICT);
    expect(harness.body().message).toBe(ERROR_CODE_SPECS[ErrorCode.RESOURCE_CONFLICT].message);
  });

  it('maps a foreign-key violation to a 409 conflict', () => {
    const harness = createHarness();
    runFilter(harness, queryFailedError('23503', 'FK_garments_categoryId'));
    expect(harness.status()).toBe(HttpStatus.CONFLICT);
  });

  it('maps an invalid uuid cast to a validation error', () => {
    const harness = createHarness();
    runFilter(harness, queryFailedError('22P02', ''));
    expect(harness.status()).toBe(HttpStatus.BAD_REQUEST);
    expect(harness.body().errorCode).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('maps an unrecognised SQLSTATE to INTERNAL_ERROR rather than guessing', () => {
    const harness = createHarness();
    runFilter(harness, queryFailedError('42601', ''));
    expect(harness.status()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(harness.body().errorCode).toBe(ErrorCode.INTERNAL_ERROR);
  });

  it('never leaks SQL, parameters, the constraint name or the driver detail', () => {
    const harness = createHarness();
    runFilter(harness, queryFailedError('23505', 'UQ_garments_sku'));

    const serialised = JSON.stringify(harness.body());
    expect(serialised).not.toContain('INSERT INTO');
    expect(serialised).not.toContain('UQ_garments_sku');
    expect(serialised).not.toContain('ZR-001');
    expect(serialised).not.toContain('duplicate key');
    expect(harness.body()).not.toHaveProperty('stack');
  });

  it('records the constraint in the server-side log, where an operator can use it', () => {
    const harness = createHarness();
    runFilter(harness, queryFailedError('23505', 'UQ_garments_sku'));
    expect(JSON.stringify(harness.logs().at(-1))).toContain('UQ_garments_sku');
  });
});

describe('GlobalExceptionFilter — NestJS HttpException', () => {
  it('maps a 404 to RESOURCE_NOT_FOUND with §2.4 copy, not the framework message', () => {
    const harness = createHarness();
    runFilter(harness, new NestNotFoundException('Cannot GET /api/v1/nope'));

    expect(harness.status()).toBe(404);
    expect(harness.body().errorCode).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(harness.body().message).toBe(ERROR_CODE_SPECS[ErrorCode.RESOURCE_NOT_FOUND].message);
    expect(harness.body().message).not.toContain('Cannot GET');
  });

  it('maps a 400 to VALIDATION_ERROR', () => {
    const harness = createHarness();
    runFilter(harness, new BadRequestException('Unexpected token } in JSON at position 12'));

    expect(harness.status()).toBe(400);
    expect(harness.body().errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    expect(JSON.stringify(harness.body())).not.toContain('Unexpected token');
  });

  it('preserves an unmapped status instead of forcing it to 500', () => {
    const harness = createHarness();
    runFilter(harness, new HttpException('Method not allowed', HttpStatus.METHOD_NOT_ALLOWED));
    expect(harness.status()).toBe(HttpStatus.METHOD_NOT_ALLOWED);
  });
});

describe('GlobalExceptionFilter — unknown exceptions', () => {
  it('becomes INTERNAL_ERROR with the fixed §2.4 copy', () => {
    const harness = createHarness();
    runFilter(harness, new TypeError('Cannot read properties of undefined (reading "hash")'));

    expect(harness.status()).toBe(500);
    expect(harness.body().errorCode).toBe(ErrorCode.INTERNAL_ERROR);
    expect(harness.body().message).toBe(ERROR_CODE_SPECS[ErrorCode.INTERNAL_ERROR].message);
  });

  it('never sends a stack trace or the internal message to the client', () => {
    const harness = createHarness();
    const error = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    runFilter(harness, error);

    const serialised = JSON.stringify(harness.body());
    expect(serialised).not.toContain('ECONNREFUSED');
    expect(serialised).not.toContain('at ');
    expect(harness.body()).not.toHaveProperty('stack');
  });

  it('logs the stack server-side, at error level, with the request id', () => {
    const harness = createHarness();
    runFilter(harness, new Error('boom'));

    const line = harness.logs().at(-1) ?? {};
    expect(line.level).toBe('error');
    expect(line.traceId).toBe(TRACE_ID);
    expect(typeof line.stack).toBe('string');
  });

  it('survives a non-Error being thrown', () => {
    const harness = createHarness();
    expect(() => runFilter(harness, 'a bare string')).not.toThrow();
    expect(harness.body().errorCode).toBe(ErrorCode.INTERNAL_ERROR);
  });
});

describe('GlobalExceptionFilter — logging and metrics', () => {
  it('logs 4xx at warn and 5xx at error', () => {
    const warned = createHarness();
    runFilter(warned, new AppException(ErrorCode.GARMENT_NOT_FOUND));
    expect((warned.logs().at(-1) ?? {}).level).toBe('warn');

    const errored = createHarness();
    runFilter(errored, new AppException(ErrorCode.STORAGE_WRITE_FAILED));
    expect((errored.logs().at(-1) ?? {}).level).toBe('error');
  });

  it('strips the query string from the logged path (E-12)', () => {
    const harness = createHarness({ url: '/api/v1/tryon?email=ayesha@example.com' });
    runFilter(harness, new AppException(ErrorCode.GARMENT_NOT_FOUND));

    const serialised = JSON.stringify(harness.logs().at(-1));
    expect(serialised).not.toContain('ayesha@example.com');
    expect(serialised).toContain('/api/v1/tryon');
  });

  it('emits errors.by_code tagged with the true code', () => {
    const harness = createHarness();
    runFilter(harness, new OwnershipException(ErrorCode.JOB_NOT_OWNED));

    const snapshot = harness.metrics.snapshot();
    const series = snapshot?.series.find((entry) => entry.name === METRICS.ERRORS_BY_CODE);
    expect(series?.tags).toMatchObject({
      errorCode: ErrorCode.JOB_NOT_OWNED,
      status: 404,
      masked: true,
    });
    expect(series?.value).toBe(1);
  });

  it('emits errors.unhandled for an unexpected exception', () => {
    const harness = createHarness();
    runFilter(harness, new RangeError('nope'));

    const snapshot = harness.metrics.snapshot();
    expect(snapshot?.series.some((entry) => entry.name === METRICS.ERRORS_UNHANDLED)).toBe(true);
  });

  it('writes no body once headers have been sent', () => {
    const harness = createHarness({ headersSent: true });
    runFilter(harness, new Error('mid-stream failure'));

    expect(harness.status()).toBe(0);
    expect(harness.body()).toBeUndefined();
    // Still logged, so the failure is not invisible.
    expect(harness.logs()).not.toHaveLength(0);
  });
});
