import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ErrorCode } from '../constants/error-codes.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthException } from '../exceptions/auth.exception';
import {
  SESSION_RESOLVER,
  type SessionResolutionContext,
  type SessionResolver,
} from '../interfaces/session-resolver.interface';
import { RequestContext } from '../logger/request-context';

import { readCookie, type CookieBearingRequest } from './csrf.guard';

import type { ICurrentUser } from '../interfaces/current-user.interface';

/** Default session cookie name. Overridden by `SESSION_COOKIE_NAME` (§7). */
export const DEFAULT_SESSION_COOKIE_NAME = 'drape.sid';

interface SessionRequest extends CookieBearingRequest {
  user?: ICurrentUser;
  ip?: string;
  path?: string;
  originalUrl?: string;
  url?: string;
}

/**
 * Session authentication — ARCHITECTURE.md §2.7, guard **3** of 4.
 *
 * Skipped when `@Public()`, except that a public route still gets `request.user`
 * populated when a valid session happens to be presented, so `@CurrentUser()`
 * behaves as §2.6 describes.
 *
 * **This guard performs no session lookup.** Reading `sessions` by sha256 hash,
 * checking `revokedAt` / `expiresAt` / `absoluteExpiresAt` / `twofaPending`, sliding
 * `expiresAt` (12 h admin, 30 d consumer — S-7), updating `lastSeenAt` and
 * `users.lastActiveAt`, and building `ICurrentUser` all belong to the auth module,
 * which binds an implementation to `SESSION_RESOLVER`. `libs/*` must not import from
 * `@api/*` (§1.1), so the seam is the `SessionResolver` interface declared beside
 * this guard.
 *
 * → `AUTH_REQUIRED` when no cookie is presented on a protected route;
 * `SESSION_INVALID` when the resolver declines the token. The resolver itself raises
 * `SESSION_EXPIRED`, `TWOFA_REQUIRED`, `ACCOUNT_SUSPENDED` and `ACCOUNT_DEACTIVATED`,
 * because only it can tell those apart.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly reflector: Reflector,
    @Inject(SESSION_RESOLVER) private readonly sessionResolver: SessionResolver,
  ) {
    // Not a secret — a cookie name is visible to every client by definition.
    this.cookieName = process.env.SESSION_COOKIE_NAME ?? DEFAULT_SESSION_COOKIE_NAME;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<string>() !== 'http') {
      return true;
    }

    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    const request = context.switchToHttp().getRequest<SessionRequest>();
    const sessionToken = readCookie(request, this.cookieName);

    if (sessionToken === undefined) {
      if (isPublic) {
        return true;
      }
      throw new AuthException(ErrorCode.AUTH_REQUIRED);
    }

    const resolutionContext: SessionResolutionContext = {
      ip: request.ip,
      userAgent: readUserAgent(request),
      method: (request.method ?? 'GET').toUpperCase(),
      path: request.path ?? stripQuery(request.originalUrl ?? request.url ?? ''),
      isPublicRoute: isPublic,
    };

    let user: ICurrentUser | null;
    try {
      user = await this.sessionResolver.resolve(sessionToken, resolutionContext);
    } catch (error) {
      // A public route must never fail because a stale cookie was presented.
      if (isPublic) {
        return true;
      }
      throw error;
    }

    if (user === null) {
      if (isPublic) {
        return true;
      }
      throw new AuthException(ErrorCode.SESSION_INVALID);
    }

    request.user = user;
    RequestContext.setUserId(user.id);
    return true;
  }
}

function readUserAgent(request: SessionRequest): string | undefined {
  const value = request.headers['user-agent'];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' && single.length > 0 ? single : undefined;
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
