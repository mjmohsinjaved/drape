import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AuthException,
  ErrorCode,
  fingerprint,
  UserStatus,
  type ICurrentUser,
  type SessionResolutionContext,
  type SessionResolver,
} from '@library/common';

import { USER_DIRECTORY } from '../auth.constants';

import { SessionService } from './session.service';

import type { Session } from '../entities/session.entity';
import type { AuthUser, UserDirectory } from '../interfaces/user-directory.interface';

/**
 * The implementation behind `SESSION_RESOLVER` — ARCHITECTURE §2.7 guard 3.
 *
 * `SessionAuthGuard` lives in `@library/common` and performs **no** session lookup;
 * it reads the cookie and delegates here, because `libs/*` may not import from
 * `@api/*` (§1.1) and only this module may read a `sessions` row. Until `AuthModule`
 * binds this class the API cannot boot — deliberately, per the note in
 * `global-providers.ts`: a stand-in that silently authorises, or silently rejects, is
 * worse than a failed start.
 *
 * The order of checks is the order §2.7 gives, and each one has a distinct code so
 * the client can be told what to do next:
 *
 * 1. unknown or revoked token → `SESSION_INVALID`
 * 2. idle or absolute expiry passed → `SESSION_EXPIRED`
 * 3. the account is gone → `SESSION_INVALID`
 * 4. `SUSPENDED` → `ACCOUNT_SUSPENDED`, `DEACTIVATED` → `ACCOUNT_DEACTIVATED` (A-2, A-19)
 *
 * `SESSION_INVALID` and `SESSION_EXPIRED` deliberately share their consumer copy so
 * neither reveals whether the token was ever real.
 *
 * **The role comes from `users`, never from the cookie and never from the
 * `sessions.role` snapshot** (S-3). The snapshot exists for cheap reads elsewhere;
 * if the two disagree — a role changed mid-session — `users` wins here.
 */
@Injectable()
export class SessionResolverService implements SessionResolver {
  private readonly logger = new Logger(SessionResolverService.name);

  constructor(
    private readonly sessionService: SessionService,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}

  async resolve(
    sessionToken: string,
    context: SessionResolutionContext,
  ): Promise<ICurrentUser | null> {
    const now = new Date();

    const session = await this.sessionService.findByToken(sessionToken);
    if (session === null || session.revokedAt !== null) {
      return this.decline(context, ErrorCode.SESSION_INVALID);
    }

    if (this.sessionService.isExpired(session, now)) {
      return this.decline(context, ErrorCode.SESSION_EXPIRED);
    }

    const user = await this.users.findById(session.userId);
    if (user === null) {
      // The row went away under a live session — a hard delete or a failed cascade.
      // Log it: it is not something a client can cause, so it is worth knowing about.
      this.logger.warn(
        `session ${fingerprint(session.id)} references a user that no longer exists`,
      );
      return this.decline(context, ErrorCode.SESSION_INVALID);
    }

    if (user.status === UserStatus.SUSPENDED) {
      return this.decline(context, ErrorCode.ACCOUNT_SUSPENDED);
    }
    if (user.status === UserStatus.DEACTIVATED) {
      return this.decline(context, ErrorCode.ACCOUNT_DEACTIVATED);
    }

    await this.recordActivity(session, user, now);

    return toCurrentUser(session, user);
  }

  /**
   * Slides the session and stamps `users.lastActiveAt` — both throttled together.
   *
   * `lastActiveAt` drives A-16 and the §9.3 30-day photo purge, so it has to be
   * roughly right, not exact. Writing it only when the session write happens keeps
   * both to one UPDATE a minute instead of two per request.
   */
  private async recordActivity(session: Session, user: AuthUser, now: Date): Promise<void> {
    const wrote = await this.sessionService.touch(session, now);
    if (!wrote) {
      return;
    }
    try {
      await this.users.update(user.id, { lastActiveAt: now });
    } catch (error) {
      // Activity bookkeeping must never fail a request that is otherwise authorised.
      this.logger.warn(
        `could not update lastActiveAt for user ${fingerprint(user.id)}: ${describe(error)}`,
      );
    }
  }

  /**
   * A public route never fails because a stale cookie came along — it just resolves
   * to nobody, so `@CurrentUser()` is `undefined` (§2.6). A protected route gets the
   * precise reason.
   */
  private decline(context: SessionResolutionContext, code: ErrorCode): null {
    if (context.isPublicRoute) {
      return null;
    }
    throw new AuthException(code);
  }
}

/** `/api/v1/auth/me` → `/auth/me`. Also tolerates a missing prefix and a trailing slash. */
export function normaliseResolutionPath(path: string): string {
  const withoutPrefix = path.replace(/^\/api(\/v\d+)?(?=\/)/, '');
  const trimmed = withoutPrefix.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** `sessions` ⋈ `users` → the §2.6 caller. Nothing here comes from the client. */
export function toCurrentUser(session: Session, user: AuthUser): ICurrentUser {
  return {
    id: user.id,
    // S-3: authoritative from `users`, re-read on every request.
    role: user.role,
    email: user.email,
    name: user.name,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    sessionId: session.id,
    locale: user.locale,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
