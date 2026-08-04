import {
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  CanceledError,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type ApiErrorResponse, type ApiResponse } from '../types/envelope';

import {
  CLIENT_ERROR_MESSAGES,
  handleSessionEnded,
  isAuthRoute,
  isSessionEndedError,
  normaliseError,
  resetSessionEndedGuard,
  setAuthFailureHandler,
  unwrapEnvelope,
} from './response.interceptor';

function makeConfig(): InternalAxiosRequestConfig {
  return { headers: new AxiosHeaders(), url: '/tryon' };
}

function makeResponse<T>(data: T): AxiosResponse<T> {
  const config = makeConfig();
  return { data, status: 200, statusText: 'OK', headers: config.headers, config };
}

function makeAxiosError(init: {
  status?: number;
  data?: unknown;
  code?: string;
  message?: string;
}): AxiosError {
  const config = makeConfig();

  const response: AxiosResponse | undefined =
    init.status === undefined
      ? undefined
      : {
          data: init.data,
          status: init.status,
          statusText: '',
          headers: config.headers,
          config,
        };

  return new AxiosError(init.message ?? 'boom', init.code, config, {}, response);
}

const SUCCESS_ENVELOPE: ApiResponse<{ id: string; title: string }> = {
  success: true,
  statusCode: 200,
  message: 'Garment retrieved successfully',
  data: { id: '0c0a', title: 'Zarrin Bridal Lehenga' },
  timestamp: '2026-08-05T09:14:22.113Z',
  path: '/api/v1/catalog/garments/0c0a',
  requestId: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c',
};

const PAGINATED_ENVELOPE: ApiResponse<Array<{ id: string }>> = {
  success: true,
  statusCode: 200,
  message: 'Success',
  data: [{ id: 'a' }, { id: 'b' }],
  meta: { page: 1, limit: 24, total: 137, totalPages: 6, sortBy: 'createdAt', sortOrder: 'DESC' },
  timestamp: '2026-08-05T09:14:22.113Z',
  path: '/api/v1/catalog/garments?page=1&limit=24',
  requestId: '6f8b1a2c',
};

const QUOTA_ERROR_ENVELOPE: ApiErrorResponse = {
  success: false,
  statusCode: 403,
  errorCode: 'QUOTA_EXHAUSTED',
  message:
    "You've used your try-ons this month — your shortlist is saved, and you can send an enquiry any time.",
  errors: [],
  details: { period: '2026-08', limit: 15, used: 15, resetsAt: '2026-09-01T00:00:00.000Z' },
  timestamp: '2026-08-05T09:14:22.113Z',
  path: '/api/v1/tryon',
  requestId: '6f8b1a2c',
};

describe('unwrapEnvelope — §2.3 success envelope', () => {
  it('replaces the body with `data` for a single resource', () => {
    const unwrapped = unwrapEnvelope<{ id: string; title: string }>(makeResponse(SUCCESS_ENVELOPE));

    expect(unwrapped.data).toEqual({ id: '0c0a', title: 'Zarrin Bridal Lehenga' });
    expect(unwrapped.data).not.toHaveProperty('success');
  });

  it('keeps the non-payload envelope fields on the response for callers that need them', () => {
    const unwrapped = unwrapEnvelope(makeResponse(SUCCESS_ENVELOPE));

    expect(unwrapped.envelope).toEqual({
      statusCode: 200,
      message: 'Garment retrieved successfully',
      timestamp: SUCCESS_ENVELOPE.timestamp,
      path: SUCCESS_ENVELOPE.path,
      requestId: SUCCESS_ENVELOPE.requestId,
      meta: undefined,
    });
  });

  it('lifts `meta` beside the rows for a paginated list', () => {
    const unwrapped = unwrapEnvelope<{ items: Array<{ id: string }>; meta: unknown }>(
      makeResponse(PAGINATED_ENVELOPE),
    );

    expect(unwrapped.data.items).toHaveLength(2);
    expect(unwrapped.data.meta).toEqual(PAGINATED_ENVELOPE.meta);
    expect(unwrapped.envelope?.meta).toEqual(PAGINATED_ENVELOPE.meta);
  });

  it('passes a non-enveloped body straight through', () => {
    const binaryish = { notAnEnvelope: true };
    const unwrapped = unwrapEnvelope(makeResponse(binaryish));

    expect(unwrapped.data).toBe(binaryish);
    expect(unwrapped.envelope).toBeUndefined();
  });
});

describe('normaliseError — §2.4 error normalisation', () => {
  it('maps the error envelope onto ApiError, keeping details and requestId', () => {
    const error = normaliseError(makeAxiosError({ status: 403, data: QUOTA_ERROR_ENVELOPE }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('QUOTA_EXHAUSTED');
    expect(error.message).toBe(QUOTA_ERROR_ENVELOPE.message);
    expect(error.details).toEqual(QUOTA_ERROR_ENVELOPE.details);
    expect(error.requestId).toBe('6f8b1a2c');
    expect(error.traceId).toBe('6f8b1a2c');
    expect(error.is('QUOTA_EXHAUSTED')).toBe(true);
    expect(error.isOneOf('BUDGET_EXHAUSTED', 'QUOTA_EXHAUSTED')).toBe(true);
    expect(error.isRetryable).toBe(false);
  });

  it('keeps field-level errors for VALIDATION_ERROR and exposes them per field', () => {
    const envelope: ApiErrorResponse = {
      ...QUOTA_ERROR_ENVELOPE,
      statusCode: 400,
      errorCode: 'VALIDATION_ERROR',
      message: 'Check the highlighted fields.',
      errors: [{ field: 'email', message: 'That email is already in use.', code: 'IS_UNIQUE' }],
      details: undefined,
    };

    const error = normaliseError(makeAxiosError({ status: 400, data: envelope }));

    expect(error.errors).toHaveLength(1);
    expect(error.fieldError('email')).toBe('That email is already in use.');
    expect(error.fieldError('password')).toBeUndefined();
  });

  it('drops malformed entries from errors[] rather than trusting the wire', () => {
    const envelope = {
      ...QUOTA_ERROR_ENVELOPE,
      errorCode: 'VALIDATION_ERROR',
      errors: [{ field: 'email', message: 'Bad' }, 'not-a-field-error', null],
    };

    const error = normaliseError(makeAxiosError({ status: 400, data: envelope }));

    expect(error.errors).toEqual([{ field: 'email', message: 'Bad' }]);
  });

  // The case §6.4 calls out explicitly: no response, therefore no envelope to unwrap.
  it('synthesises NETWORK_ERROR when there is no response at all', () => {
    const error = normaliseError(makeAxiosError({ code: 'ERR_NETWORK', message: 'Network Error' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(0);
    expect(error.errorCode).toBe('NETWORK_ERROR');
    expect(error.message).toBe(CLIENT_ERROR_MESSAGES.NETWORK_ERROR);
    expect(error.errors).toEqual([]);
    expect(error.isRetryable).toBe(true);
  });

  it('synthesises REQUEST_TIMEOUT for an aborted-by-timeout request', () => {
    const error = normaliseError(
      makeAxiosError({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }),
    );

    expect(error.statusCode).toBe(408);
    expect(error.errorCode).toBe('REQUEST_TIMEOUT');
    expect(error.message).toBe(CLIENT_ERROR_MESSAGES.REQUEST_TIMEOUT);
    expect(error.isRetryable).toBe(true);
  });

  it('marks a deliberate cancellation as REQUEST_ABORTED and not retryable', () => {
    const error = normaliseError(new CanceledError('canceled'));

    expect(error.errorCode).toBe('REQUEST_ABORTED');
    expect(error.isRetryable).toBe(false);
  });

  it('never surfaces a raw non-envelope body as user-facing copy', () => {
    const error = normaliseError(
      makeAxiosError({ status: 502, data: '<html>nginx gateway error</html>' }),
    );

    expect(error.statusCode).toBe(502);
    expect(error.errorCode).toBe('UNKNOWN_ERROR');
    expect(error.message).toBe(CLIENT_ERROR_MESSAGES.UNKNOWN_ERROR);
    expect(error.message).not.toContain('nginx');
    expect(error.isRetryable).toBe(true);
  });

  it('wraps a non-axios throwable', () => {
    const error = normaliseError(new TypeError('undefined is not a function'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.errorCode).toBe('UNKNOWN_ERROR');
    expect(error.statusCode).toBe(0);
  });

  it('returns an ApiError unchanged rather than double-wrapping it', () => {
    const original = new ApiError({ statusCode: 404, errorCode: 'GARMENT_NOT_FOUND', message: 'x' });

    expect(normaliseError(original)).toBe(original);
  });

  it('flags an unknown server code so the UI can fall back to generic copy', () => {
    const error = normaliseError(
      makeAxiosError({
        status: 418,
        data: { ...QUOTA_ERROR_ENVELOPE, statusCode: 418, errorCode: 'CODE_FROM_THE_FUTURE' },
      }),
    );

    expect(error.isKnownCode).toBe(false);
    expect(normaliseError(makeAxiosError({ status: 403, data: QUOTA_ERROR_ENVELOPE })).isKnownCode).toBe(
      true,
    );
  });

  it('exposes details.retryAfterSeconds for a throttled request', () => {
    const error = normaliseError(
      makeAxiosError({
        status: 429,
        data: {
          ...QUOTA_ERROR_ENVELOPE,
          statusCode: 429,
          errorCode: 'RATE_LIMIT_EXCEEDED',
          details: { retryAfterSeconds: 42 },
        },
      }),
    );

    expect(error.retryAfterSeconds).toBe(42);
  });
});

describe('session-ended handling', () => {
  afterEach(() => {
    resetSessionEndedGuard();
  });

  it.each(['AUTH_REQUIRED', 'SESSION_EXPIRED', 'SESSION_INVALID'])(
    'treats %s as a dead session',
    (errorCode) => {
      const error = new ApiError({ statusCode: 401, errorCode, message: 'Sign in to continue.' });
      expect(isSessionEndedError(error)).toBe(true);
    },
  );

  it('does not treat the 2FA challenge as a dead session', () => {
    const error = new ApiError({
      statusCode: 401,
      errorCode: 'TWOFA_REQUIRED',
      message: 'Enter the code from your authenticator app.',
    });

    expect(isSessionEndedError(error)).toBe(false);
  });

  it('does not treat a 403 as a dead session', () => {
    const error = new ApiError({
      statusCode: 403,
      errorCode: 'INSUFFICIENT_ROLE',
      message: "You don't have access to this.",
    });

    expect(isSessionEndedError(error)).toBe(false);
  });

  it('clears auth state through the registered handler', () => {
    const clear = vi.fn();
    setAuthFailureHandler(clear);

    const error = new ApiError({ statusCode: 401, errorCode: 'SESSION_EXPIRED', message: 'x' });
    handleSessionEnded(error);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(error);
  });

  const authRouteCases: Array<[string, boolean]> = [
    ['/login', true],
    ['/ur/login', true],
    ['/reset-password', true],
    ['/invite/abc123', true],
    ['/en/two-factor', true],
    ['/dashboard', false],
    ['/catalog/garments', false],
    // Not an auth route, despite containing the substring "login".
    ['/admin/logins-report', false],
  ];

  it.each(authRouteCases)('isAuthRoute(%s) === %s — the redirect-loop guard', (pathname, expected) => {
    expect(isAuthRoute(pathname)).toBe(expected);
  });
});
