import { describe, expect, it } from 'vitest';

import {
  ApiError,
  AUTHENTICATION_REQUIRED_ERROR_CODES,
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
  PERMISSION_DENIED_ERROR_CODES,
  resolveErrorCode,
  resolveStatusCode,
} from './envelope';

/**
 * The classification that used to live three times, in three features, with three answers.
 *
 * These tests are written against the *decisions*, not the implementation: which screen a code
 * should produce, and whether offering "try again" is honest. If a code moves between the two
 * lists, one of these fails and the reason has to be argued rather than noticed later on screen.
 */

function apiError(errorCode: string, statusCode: number): ApiError {
  return new ApiError({ statusCode, errorCode, message: 'diagnostic, not display copy' });
}

describe('permission denied vs authentication required', () => {
  it('treats "your account may not do this" as permission denied', () => {
    // Signing in again changes none of these answers, so the S-9 screen is the right one.
    for (const code of [
      'INSUFFICIENT_ROLE',
      'ACCOUNT_SUSPENDED',
      'ACCOUNT_DEACTIVATED',
      'TWOFA_REQUIRED_FOR_ROLE',
      'DELETION_IN_PROGRESS',
    ]) {
      expect(isPermissionDenied(code), code).toBe(true);
      expect(isAuthenticationRequired(code), code).toBe(false);
    }
  });

  it('treats "we do not know who you are" as authentication, not authorisation', () => {
    // The disagreement that started this: try-on called these denied, auth did not. They are
    // authentication failures — the honest screen offers a way back in, not a dead end.
    for (const code of ['AUTH_REQUIRED', 'SESSION_EXPIRED', 'SESSION_INVALID']) {
      expect(isAuthenticationRequired(code), code).toBe(true);
      expect(isPermissionDenied(code), code).toBe(false);
    }
  });

  it('keeps the two sets disjoint', () => {
    const overlap = PERMISSION_DENIED_ERROR_CODES.filter((code) =>
      (AUTHENTICATION_REQUIRED_ERROR_CODES as readonly string[]).includes(code),
    );
    expect(overlap).toEqual([]);
  });

  it('says no to an ordinary failure', () => {
    for (const code of ['VALIDATION_ERROR', 'INTERNAL_ERROR', 'NETWORK_ERROR', 'GARMENT_NOT_FOUND']) {
      expect(isPermissionDenied(code), code).toBe(false);
      expect(isAuthenticationRequired(code), code).toBe(false);
    }
  });

  it('exposes both on ApiError, beside isRetryable', () => {
    expect(apiError('INSUFFICIENT_ROLE', 403).isPermissionDenied).toBe(true);
    expect(apiError('INSUFFICIENT_ROLE', 403).isAuthenticationRequired).toBe(false);
    expect(apiError('SESSION_EXPIRED', 401).isAuthenticationRequired).toBe(true);
    expect(apiError('SESSION_EXPIRED', 401).isPermissionDenied).toBe(false);
  });
});

describe('isRetryableCode', () => {
  it('never offers a retry on a known dead end, whatever the status said', () => {
    // The veto is the point: a 429 QUOTA_EXHAUSTED would otherwise get a button that cannot
    // possibly help (§10.3).
    expect(isRetryableCode('QUOTA_EXHAUSTED', 429)).toBe(false);
    expect(isRetryableCode('QUOTA_EXHAUSTED')).toBe(false);
    expect(isRetryableCode('BUDGET_EXHAUSTED', 503)).toBe(false);
    expect(isRetryableCode('CONSENT_REQUIRED')).toBe(false);
    expect(isRetryableCode('MODERATION_REJECTED')).toBe(false);
    expect(apiError('QUOTA_EXHAUSTED', 429).isRetryable).toBe(false);
  });

  it('still offers a retry on the transport and server classes', () => {
    expect(isRetryableCode('NETWORK_ERROR', 0)).toBe(true);
    expect(isRetryableCode('REQUEST_TIMEOUT', 0)).toBe(true);
    expect(isRetryableCode('INTERNAL_ERROR', 500)).toBe(true);
    expect(isRetryableCode('SERVICE_UNAVAILABLE', 503)).toBe(true);
    expect(isRetryableCode('RATE_LIMIT_EXCEEDED', 429)).toBe(true);
    expect(isRetryableCode('UNKNOWN_ERROR', 408)).toBe(true);
  });

  it('never offers a retry for a request the caller abandoned', () => {
    expect(isRetryableCode('REQUEST_ABORTED', 0)).toBe(false);
    expect(apiError('REQUEST_ABORTED', 0).isRetryable).toBe(false);
  });

  it('refuses to re-send a mutation on a 4xx it was told about', () => {
    // With a status, the caller is asking "may I send this again?".
    expect(isRetryableCode('VALIDATION_ERROR', 422)).toBe(false);
    expect(isRetryableCode('RESOURCE_CONFLICT', 409)).toBe(false);
  });

  it('offers a re-read when no status is supplied', () => {
    // Without a status, the caller is asking "may I reload this screen?" — which is free, and
    // which much of the copy explicitly instructs ("Reload to see the current order").
    expect(isRetryableCode('RESOURCE_CONFLICT')).toBe(true);
    expect(isRetryableCode('FILE_TOKEN_EXPIRED')).toBe(true);
    // The SSE `failed` frame: a bare code and no HTTP response at all.
    expect(isRetryableCode('UPSTREAM_TIMEOUT')).toBe(true);
  });
});

describe('resolveErrorCode', () => {
  it('is total — every shape a component can be handed resolves to a code', () => {
    expect(resolveErrorCode(apiError('GARMENT_NOT_FOUND', 404))).toBe('GARMENT_NOT_FOUND');
    // A Server Component failure is a plain object, not an Error subclass.
    expect(resolveErrorCode({ errorCode: 'PHOTO_NOT_FOUND', statusCode: 404 })).toBe(
      'PHOTO_NOT_FOUND',
    );
    // The SSE `failed` event arrives as a bare string.
    expect(resolveErrorCode('UPSTREAM_UNAVAILABLE')).toBe('UPSTREAM_UNAVAILABLE');
    // Anything else at all.
    expect(resolveErrorCode(new Error('boom'))).toBe('UNKNOWN_ERROR');
    expect(resolveErrorCode(null)).toBe('UNKNOWN_ERROR');
    expect(resolveErrorCode('')).toBe('UNKNOWN_ERROR');
  });

  it('reads the status back off either shape, and undefined off neither', () => {
    expect(resolveStatusCode(apiError('INTERNAL_ERROR', 500))).toBe(500);
    expect(resolveStatusCode({ errorCode: 'INTERNAL_ERROR', statusCode: 500 })).toBe(500);
    expect(resolveStatusCode('UPSTREAM_TIMEOUT')).toBeUndefined();
  });
});

describe('the §2.3 message contract', () => {
  it('carries the server message for logs without any claim that it is display copy', () => {
    const error = apiError('INSUFFICIENT_ROLE', 403);
    // It is still here, and still the server's words — but it is English only, which is why no
    // feature renders it. Copy is selected from `errorCode` by `useErrorCopy(namespace)`.
    expect(error.message).toBe('diagnostic, not display copy');
    expect(error.errorCode).toBe('INSUFFICIENT_ROLE');
  });
});
