import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ErrorCode } from '../constants/error-codes.constant';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';
import { AuthException } from '../exceptions/auth.exception';
import { timingSafeEqualString } from '../utils/crypto.util';

/** The double-submit header. Compared against the CSRF cookie (§2.7 guard 1). */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Default CSRF cookie name. Overridden by `CSRF_COOKIE_NAME` (§7). */
export const DEFAULT_CSRF_COOKIE_NAME = 'drape.csrf';

/** Methods that cannot mutate state, so they carry no CSRF requirement. */
export const CSRF_SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The minimal request surface the CSRF and session guards read. */
export interface CookieBearingRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

/**
 * Reads a cookie, preferring `cookie-parser`'s parsed map and falling back to the
 * raw `Cookie` header so the guard still works if the parser is ever unregistered.
 */
export function readCookie(request: CookieBearingRequest, name: string): string | undefined {
  const parsed = request.cookies?.[name];
  if (typeof parsed === 'string' && parsed.length > 0) {
    return parsed;
  }

  const rawHeader = request.headers['cookie'];
  const raw = Array.isArray(rawHeader) ? rawHeader.join('; ') : rawHeader;
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }

  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length === 0 ? undefined : decodeURIComponent(value);
    }
  }
  return undefined;
}

/** Reads a single-valued header. */
function readHeader(request: CookieBearingRequest, name: string): string | undefined {
  const value = request.headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.length > 0 ? single : undefined;
}

/**
 * CSRF double-submit — ARCHITECTURE.md §2.7, guard **1** of 4.
 *
 * Skipped for `GET`/`HEAD`/`OPTIONS` and for `@SkipCsrf()`. Otherwise the
 * `X-CSRF-Token` header must equal the `drape.csrf` cookie, compared in constant
 * time so a partial match reveals nothing.
 *
 * → `CSRF_TOKEN_MISSING` when either side is absent, `CSRF_TOKEN_INVALID` when they
 * disagree.
 *
 * ### Why the HMAC step is not here
 *
 * §2.7 also describes HMAC-verifying the token against the session's `csrfSecret`.
 * That secret lives on the `sessions` row, and this guard runs **before**
 * `SessionAuthGuard` (registration order is execution order), so the session is not
 * resolved yet. Reordering the chain to load a session before the CSRF check would
 * invert the contract's fixed order. The double-submit comparison therefore lives
 * here, and the session-bound HMAC binding is verified by the auth module when it
 * resolves the session — the two together give the §2.7 property.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(private readonly reflector: Reflector) {
    // Not a secret: the CSRF cookie name is public by construction (B-8), so a
    // non-secret default is correct here and violates no E-2 rule.
    this.cookieName = process.env.CSRF_COOKIE_NAME ?? DEFAULT_CSRF_COOKIE_NAME;
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<string>() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<CookieBearingRequest>();
    const method = (request.method ?? 'GET').toUpperCase();

    if (CSRF_SAFE_METHODS.has(method)) {
      return true;
    }

    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) {
      return true;
    }

    const headerToken = readHeader(request, CSRF_HEADER_NAME);
    const cookieToken = readCookie(request, this.cookieName);

    if (headerToken === undefined || cookieToken === undefined) {
      throw new AuthException(ErrorCode.CSRF_TOKEN_MISSING);
    }

    if (!timingSafeEqualString(headerToken, cookieToken)) {
      throw new AuthException(ErrorCode.CSRF_TOKEN_INVALID);
    }

    return true;
  }
}
