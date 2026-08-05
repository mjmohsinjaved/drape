import { Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  AuthException,
  CSRF_HEADER_NAME,
  CSRF_SAFE_METHODS,
  ErrorCode,
  METRICS,
  MetricsService,
  SKIP_CSRF_KEY,
  type ICurrentUser,
} from '@library/common';

import { CsrfService } from '../services/csrf.service';
import { SessionService } from '../services/session.service';

interface CsrfBoundRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  user?: ICurrentUser;
}

/**
 * The session-bound half of the CSRF check — ARCHITECTURE §2.7 guard 1, PRD B-8.
 *
 * ### Why this guard exists, and why it is registered here
 *
 * §2.7 requires two things of a mutating request: that `X-CSRF-Token` equals the
 * `drape.csrf` cookie, **and** that the pair HMAC-verifies against the session's
 * `csrfSecret`. `CsrfGuard` (guard 1, in `@library/common`) can only do the first:
 * registration order is execution order, and it runs two guards before the session
 * exists. Its own doc comment records the gap and defers the binding to this module.
 *
 * This guard closes it. `AuthModule` binds it as an `APP_GUARD`, so it runs after
 * the four fixed guards rather than among them — the §2.7 order is untouched, and
 * the check happens at the first moment the session is actually known. By then
 * `SessionAuthGuard` has populated `request.user`, so the session row is a primary-
 * key read away.
 *
 * ### What it does not do
 *
 * It never *replaces* guard 1. A request that failed the double-submit comparison
 * never reaches here. It also stays out of the way of anonymous callers: before
 * login there is no session to bind to, the token is minted under the anonymous
 * scope, and guard 1's comparison is the whole check.
 *
 * That anonymous path is what lets `POST /auth/login`, `POST /auth/signup` and
 * `POST /invites/token/:token/accept` be CSRF-protected without holding a session:
 * the form calls `GET /auth/csrf` first, guard 1 compares header against cookie, and
 * this guard returns true because `request.user` is undefined. **None of the three
 * carries `@SkipCsrf()`.**
 */
@Injectable()
export class SessionCsrfBindingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    private readonly csrfService: CsrfService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<string>() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<CsrfBoundRequest>();
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

    const user = request.user;
    if (user === undefined) {
      // Anonymous caller on a `@Public()` route. There is no session to bind to, and
      // guard 1 has already matched the header against the cookie.
      return true;
    }

    const headerToken = readHeader(request, CSRF_HEADER_NAME);
    if (headerToken === undefined) {
      throw this.rejection(ErrorCode.CSRF_TOKEN_MISSING);
    }

    const session = await this.sessionService.findById(user.sessionId);
    if (session === null) {
      // Resolution succeeded a moment ago, so this is a revocation racing the
      // request. Treated as an invalid token rather than a 500.
      throw this.rejection(ErrorCode.CSRF_TOKEN_INVALID);
    }

    if (!this.csrfService.verifyToken(headerToken, session.csrfSecret)) {
      throw this.rejection(ErrorCode.CSRF_TOKEN_INVALID);
    }

    return true;
  }

  /** Records the E-13 metric and builds the exception the caller throws. */
  private rejection(code: ErrorCode): AuthException {
    this.metrics?.increment(METRICS.AUTH_CSRF_REJECTED, { errorCode: code });
    return new AuthException(code);
  }
}

function readHeader(request: CsrfBoundRequest, name: string): string | undefined {
  const value = request.headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.length > 0 ? single : undefined;
}
