import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GC_TIME_MS,
  DEFAULT_STALE_TIME_MS,
  MAX_QUERY_RETRIES,
  createQueryClient,
  retryDelayMs,
  shouldRetryRequest,
} from './query-client';
import { ApiError } from './types/envelope';

function apiError(statusCode: number, errorCode: string): ApiError {
  return new ApiError({ statusCode, errorCode, message: 'x' });
}

describe('createQueryClient — §6.4 defaults', () => {
  it('applies the documented query defaults', () => {
    const defaults = createQueryClient().getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(DEFAULT_STALE_TIME_MS);
    expect(DEFAULT_STALE_TIME_MS).toBe(60_000);
    expect(defaults?.gcTime).toBe(DEFAULT_GC_TIME_MS);
    expect(DEFAULT_GC_TIME_MS).toBe(5 * 60_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.refetchOnReconnect).toBe(true);
    // D-5: states are rendered, not thrown.
    expect(defaults?.throwOnError).toBe(false);
  });

  it('never retries a mutation', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe('shouldRetryRequest — never retries a 4xx', () => {
  it.each([400, 401, 403, 404, 409, 410, 413, 415, 422, 423, 429, 499])(
    'refuses to retry a %i',
    (statusCode) => {
      expect(shouldRetryRequest(0, apiError(statusCode, 'RESOURCE_CONFLICT'))).toBe(false);
    },
  );

  it('refuses to retry 408 and 429 even though ApiError marks them retryable', () => {
    const timeout = apiError(408, 'REQUEST_TIMEOUT');
    const throttled = apiError(429, 'RATE_LIMIT_EXCEEDED');

    // The wider predicate that drives the "Try again" button still says yes…
    expect(timeout.isRetryable).toBe(true);
    expect(throttled.isRetryable).toBe(true);
    // …but an automatic retry must not amplify load against a rate limiter.
    expect(shouldRetryRequest(0, timeout)).toBe(false);
    expect(shouldRetryRequest(0, throttled)).toBe(false);
  });

  it.each([500, 502, 503, 504])('retries a %i', (statusCode) => {
    expect(shouldRetryRequest(0, apiError(statusCode, 'SERVICE_UNAVAILABLE'))).toBe(true);
  });

  it('retries a network failure that never reached the API', () => {
    expect(shouldRetryRequest(0, apiError(0, 'NETWORK_ERROR'))).toBe(true);
  });

  it('does not retry a deliberate cancellation', () => {
    expect(shouldRetryRequest(0, apiError(0, 'REQUEST_ABORTED'))).toBe(false);
  });

  it('stops after MAX_QUERY_RETRIES attempts', () => {
    const error = apiError(503, 'SERVICE_UNAVAILABLE');

    expect(shouldRetryRequest(MAX_QUERY_RETRIES - 1, error)).toBe(true);
    expect(shouldRetryRequest(MAX_QUERY_RETRIES, error)).toBe(false);
    expect(shouldRetryRequest(MAX_QUERY_RETRIES + 1, error)).toBe(false);
  });

  it('does not retry something that never went through the interceptor', () => {
    expect(shouldRetryRequest(0, new Error('boom'))).toBe(false);
    expect(shouldRetryRequest(0, undefined)).toBe(false);
    expect(shouldRetryRequest(0, { statusCode: 503 })).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially and caps at 15 s', () => {
    expect(retryDelayMs(0)).toBe(1_000);
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(10)).toBe(15_000);
  });
});
