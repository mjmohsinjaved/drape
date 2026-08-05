import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ErrorCode } from '../constants/error-codes.constant';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';
import { AppException } from '../exceptions/app.exception';
import { AuthException } from '../exceptions/auth.exception';

import { CsrfGuard, DEFAULT_CSRF_COOKIE_NAME, readCookie } from './csrf.guard';

interface HarnessOptions {
  method?: string;
  header?: string;
  cookie?: string;
  rawCookieHeader?: string;
  skipCsrf?: boolean;
  contextType?: string;
}

function createContext(options: HarnessOptions = {}): ExecutionContext {
  const headers: Record<string, string | undefined> = {};
  if (options.header !== undefined) {
    headers['x-csrf-token'] = options.header;
  }
  if (options.rawCookieHeader !== undefined) {
    headers['cookie'] = options.rawCookieHeader;
  }

  const cookies: Record<string, string> = {};
  if (options.cookie !== undefined) {
    cookies[DEFAULT_CSRF_COOKIE_NAME] = options.cookie;
  }

  return {
    getType: <T>(): T => (options.contextType ?? 'http') as unknown as T,
    getHandler: () => function handler(): void {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: <T>(): T =>
        ({ method: options.method ?? 'POST', headers, cookies }) as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

function createGuard(skipCsrf = false): CsrfGuard {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (key === SKIP_CSRF_KEY ? skipCsrf : undefined)),
  } as unknown as Reflector;
  return new CsrfGuard(reflector);
}

function activate(options: HarnessOptions = {}): boolean {
  return createGuard(options.skipCsrf ?? false).canActivate(createContext(options));
}

describe('CsrfGuard — skips', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get', 'head', 'options'])(
    'skips the safe method %s',
    (method) => {
      expect(activate({ method })).toBe(true);
    },
  );

  it('skips @SkipCsrf() — the ticket-redemption route carries its credential in the URL', () => {
    expect(activate({ method: 'POST', skipCsrf: true })).toBe(true);
  });

  it('skips a non-HTTP context', () => {
    expect(activate({ contextType: 'rpc' })).toBe(true);
  });
});

describe('CsrfGuard — double submit', () => {
  const token = 'a'.repeat(43);

  it('passes when the header equals the cookie', () => {
    expect(activate({ method: 'POST', header: token, cookie: token })).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('enforces on %s', (method) => {
    expect(() => activate({ method, header: token, cookie: token })).not.toThrow();
    expect(() => activate({ method })).toThrow(AuthException);
  });

  it('reads the cookie from the raw Cookie header when cookie-parser is absent', () => {
    expect(
      activate({
        method: 'POST',
        header: token,
        rawCookieHeader: `drape.sid=abc; ${DEFAULT_CSRF_COOKIE_NAME}=${token}; other=1`,
      }),
    ).toBe(true);
  });
});

describe('CsrfGuard — rejections', () => {
  const token = 'a'.repeat(43);

  function errorCodeOf(options: HarnessOptions): ErrorCode | undefined {
    try {
      activate(options);
      return undefined;
    } catch (error) {
      return error instanceof AppException ? error.errorCode : undefined;
    }
  }

  it('CSRF_TOKEN_MISSING when the header is absent', () => {
    expect(errorCodeOf({ method: 'POST', cookie: token })).toBe(ErrorCode.CSRF_TOKEN_MISSING);
  });

  it('CSRF_TOKEN_MISSING when the cookie is absent', () => {
    expect(errorCodeOf({ method: 'POST', header: token })).toBe(ErrorCode.CSRF_TOKEN_MISSING);
  });

  it('CSRF_TOKEN_MISSING when both are absent', () => {
    expect(errorCodeOf({ method: 'POST' })).toBe(ErrorCode.CSRF_TOKEN_MISSING);
  });

  it('CSRF_TOKEN_MISSING for an empty-string header or cookie', () => {
    expect(errorCodeOf({ method: 'POST', header: '', cookie: token })).toBe(
      ErrorCode.CSRF_TOKEN_MISSING,
    );
    expect(errorCodeOf({ method: 'POST', header: token, cookie: '' })).toBe(
      ErrorCode.CSRF_TOKEN_MISSING,
    );
  });

  it('CSRF_TOKEN_INVALID when the two disagree', () => {
    expect(errorCodeOf({ method: 'POST', header: token, cookie: 'b'.repeat(43) })).toBe(
      ErrorCode.CSRF_TOKEN_INVALID,
    );
  });

  it('CSRF_TOKEN_INVALID when they differ only in length', () => {
    expect(errorCodeOf({ method: 'POST', header: token, cookie: `${token}x` })).toBe(
      ErrorCode.CSRF_TOKEN_INVALID,
    );
  });

  it('CSRF_TOKEN_INVALID for a one-character difference', () => {
    expect(errorCodeOf({ method: 'POST', header: token, cookie: `${'a'.repeat(42)}b` })).toBe(
      ErrorCode.CSRF_TOKEN_INVALID,
    );
  });

  it('returns 403 with the §2.4 copy, identical for both codes', () => {
    try {
      activate({ method: 'POST' });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthException);
      expect((error as AppException).getStatus()).toBe(403);
      expect((error as AppException).message).toBe('Refresh the page and try again.');
    }
  });
});

describe('readCookie', () => {
  it('prefers the parsed cookie map', () => {
    expect(readCookie({ headers: {}, cookies: { 'drape.csrf': 'parsed' } }, 'drape.csrf')).toBe(
      'parsed',
    );
  });

  it('falls back to the raw header', () => {
    expect(readCookie({ headers: { cookie: 'a=1; drape.csrf=raw' } }, 'drape.csrf')).toBe('raw');
  });

  it('url-decodes the raw value', () => {
    expect(readCookie({ headers: { cookie: 'drape.csrf=a%2Bb' } }, 'drape.csrf')).toBe('a+b');
  });

  it('returns undefined for an absent or empty cookie', () => {
    expect(readCookie({ headers: {} }, 'drape.csrf')).toBeUndefined();
    expect(readCookie({ headers: { cookie: 'drape.csrf=' } }, 'drape.csrf')).toBeUndefined();
    expect(readCookie({ headers: { cookie: 'other=1' } }, 'drape.csrf')).toBeUndefined();
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    expect(readCookie({ headers: { cookie: 'xdrape.csrf=nope' } }, 'drape.csrf')).toBeUndefined();
  });
});
