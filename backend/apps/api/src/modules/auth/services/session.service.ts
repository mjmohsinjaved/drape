import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, LessThan, Repository, type EntityManager } from 'typeorm';

import { hmacSign, randomToken, Role, sha256Hex } from '@library/common';

import {
  AUTH_CONFIG,
  LAST_SEEN_WRITE_INTERVAL_MS,
  REVOKE_REASONS,
  SESSION_TOKEN_BYTES,
  type RevokeReason,
} from '../auth.constants';
import { Session } from '../entities/session.entity';

import { CsrfService, type AuthCookieOptions, type CookieWritingResponse } from './csrf.service';

import type { AuthConfig } from '../config/auth.config';
import type { AuthUser } from '../interfaces/user-directory.interface';

/** Domain separator for session-token derivation, so the key is single-purpose. */
const SESSION_HMAC_DOMAIN = 'session:';

export interface IssueSessionInput {
  readonly user: Pick<AuthUser, 'id' | 'role'>;
  readonly ip: string;
  readonly userAgent: string | null;
  /** True when 2FA is enabled and the TOTP step has not been completed yet (S-8). */
  readonly twofaPending: boolean;
  readonly now: Date;
}

export interface IssuedSession {
  readonly session: Session;
  /** The opaque cookie value. Returned once; only its derived hash is stored. */
  readonly token: string;
  /** A CSRF token already bound to this session's `csrfSecret`. */
  readonly csrfToken: string;
}

/** Options for the two revocation methods. */
export interface RevokeOptions {
  /**
   * The transactional manager of a caller's `runInTransaction` block.
   *
   * When present, the UPDATE is issued through it, so the revocation commits — or
   * rolls back — with whatever else that transaction is doing. That is the whole of
   * A-2 and A-19: a `users.status` change and the matching session revocation are
   * one unit of work, and there is no window in which the account is deactivated
   * but its cookie still resolves (§2.9 rule 3, §2.7).
   */
  readonly manager?: EntityManager;
}

/** {@link SessionService.revokeAllForUser} options. */
export interface RevokeAllOptions extends RevokeOptions {
  /** Leaves one session alive — `DELETE /auth/sessions` revokes the *others* (§5.1). */
  readonly exceptSessionId?: string;
}

/**
 * Server-side sessions — ARCHITECTURE §4.5, PRD S-7, §9.2.
 *
 * No JWT and no NextAuth (§0): the cookie carries 32 random bytes and nothing else,
 * so a session is revoked by writing one row, not by waiting for a token to expire.
 *
 * ### What is stored
 *
 * `tokenHash` is `sha256(HMAC-SHA256("session:" + token, SESSION_SECRET))`. §4.5 asks
 * for a sha256 and §7 says `SESSION_SECRET` is "the HMAC key for session token
 * derivation. Rotating it logs everyone out" — this construction satisfies both: the
 * column is still a 64-character digest, an attacker with a database dump still
 * cannot mint a cookie, and rotating the secret really does invalidate every row.
 *
 * ### Expiry (S-7)
 *
 * Two clocks. `expiresAt` slides forward on activity — 12 hours for an admin, 30
 * days for a consumer. `absoluteExpiresAt` never moves: 7 days and 90 days. A
 * session dies when either passes, so an attacker who steals a cookie cannot keep it
 * alive indefinitely by using it.
 *
 * ### Rotation and revocation
 *
 * The session id is rotated on every privilege change — login, 2FA completion and
 * password change — which is what stops a fixated pre-login cookie from becoming an
 * authenticated one. Deactivation, suspension and password change revoke **every**
 * row for the user (A-2, A-19), so the next request from any device fails guard 3.
 */
@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly csrfService: CsrfService,
  ) {}

  /** Sliding idle window for a role, in milliseconds (S-7). */
  idleWindowMs(role: Role): number {
    return this.config.idleMs[role];
  }

  /** Hard ceiling for a role, in milliseconds (§4.5). */
  absoluteWindowMs(role: Role): number {
    return this.config.absoluteMs[role];
  }

  /** Derives the stored hash from a raw cookie value. */
  hashToken(token: string): string {
    return sha256Hex(
      hmacSign(token, this.config.sessionSecret, {
        domain: SESSION_HMAC_DOMAIN,
        encoding: 'hex',
      }),
    );
  }

  /** Mints a new session row and the cookie value that addresses it. */
  async issue(input: IssueSessionInput): Promise<IssuedSession> {
    const token = randomToken(SESSION_TOKEN_BYTES);
    const csrfSecret = this.csrfService.newSessionSecret();
    const role = input.user.role;

    const session = this.sessions.create({
      userId: input.user.id,
      tokenHash: this.hashToken(token),
      csrfSecret,
      role,
      ip: input.ip,
      userAgent: input.userAgent,
      lastSeenAt: input.now,
      expiresAt: new Date(input.now.getTime() + this.idleWindowMs(role)),
      absoluteExpiresAt: new Date(input.now.getTime() + this.absoluteWindowMs(role)),
      twofaPending: input.twofaPending,
      twofaVerifiedAt: null,
      revokedAt: null,
      revokedReason: null,
    });

    const saved = await this.sessions.save(session);

    return {
      session: saved,
      token,
      csrfToken: this.csrfService.issueToken(csrfSecret),
    };
  }

  /**
   * Rotates the session on a privilege change.
   *
   * The old row is revoked and a new one issued, so the cookie value the caller
   * arrived with is worthless afterwards. This is the session-fixation defence: an
   * attacker who plants a pre-login cookie does not end up holding the post-login
   * one.
   */
  async rotate(
    current: Session,
    input: Omit<IssueSessionInput, 'twofaPending'> & { twofaPending?: boolean },
  ): Promise<IssuedSession> {
    await this.revoke(current, REVOKE_REASONS.ROTATED, input.now);
    return this.issue({ ...input, twofaPending: input.twofaPending ?? false });
  }

  /** Looks a session up by the raw cookie value. */
  async findByToken(token: string): Promise<Session | null> {
    if (typeof token !== 'string' || token.length === 0) {
      return null;
    }
    return this.sessions.findOne({ where: { tokenHash: this.hashToken(token) } });
  }

  /** Looks a session up by primary key. */
  async findById(sessionId: string): Promise<Session | null> {
    return this.sessions.findOne({ where: { id: sessionId } });
  }

  /** True when either clock has passed (S-7). */
  isExpired(session: Session, now: Date): boolean {
    return (
      session.expiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime()
    );
  }

  /**
   * Slides `expiresAt` and refreshes `lastSeenAt` — throttled.
   *
   * §2.7 describes this happening on every request. Written literally, every read
   * becomes a write. The idle windows are 12 hours and 30 days, so deferring the
   * update for `LAST_SEEN_WRITE_INTERVAL_MS` cannot expire a live session, and it
   * turns a busy consumer's hundreds of UPDATEs into one a minute.
   *
   * `expiresAt` is never pushed past `absoluteExpiresAt`: the hard ceiling wins.
   *
   * @returns true when a write actually happened.
   */
  async touch(session: Session, now: Date): Promise<boolean> {
    const sinceLastWrite = now.getTime() - session.lastSeenAt.getTime();
    if (sinceLastWrite < LAST_SEEN_WRITE_INTERVAL_MS) {
      return false;
    }

    const slid = Math.min(
      now.getTime() + this.idleWindowMs(session.role),
      session.absoluteExpiresAt.getTime(),
    );

    session.lastSeenAt = now;
    session.expiresAt = new Date(slid);

    await this.sessions.update(
      { id: session.id },
      { lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt },
    );
    return true;
  }

  /** Marks the TOTP step complete and clears `twofaPending`. */
  async markTwoFactorVerified(session: Session, now: Date): Promise<void> {
    session.twofaPending = false;
    session.twofaVerifiedAt = now;
    await this.sessions.update({ id: session.id }, { twofaPending: false, twofaVerifiedAt: now });
  }

  /** Revokes one session. Idempotent — a second call leaves the first reason intact. */
  async revoke(
    session: Session,
    reason: RevokeReason,
    now: Date,
    options: RevokeOptions = {},
  ): Promise<void> {
    if (session.revokedAt !== null) {
      return;
    }
    session.revokedAt = now;
    session.revokedReason = reason;
    await this.repositoryFor(options.manager).update(
      { id: session.id, revokedAt: IsNull() },
      { revokedAt: now, revokedReason: reason },
    );
  }

  /**
   * Revokes every live session for a user — A-2 (deactivation), A-19 (suspension)
   * and every password change (S-6).
   *
   * Pass `options.manager` and both the read and every UPDATE run on the caller's
   * transaction, which is what makes "deactivation is immediate" true rather than
   * merely likely: the status change and the revocations commit together.
   *
   * @returns how many rows were revoked.
   */
  async revokeAllForUser(
    userId: string,
    reason: RevokeReason,
    now: Date,
    options: RevokeAllOptions = {},
  ): Promise<number> {
    const repository = this.repositoryFor(options.manager);
    const live = await repository.find({ where: { userId, revokedAt: IsNull() } });
    let revoked = 0;

    for (const session of live) {
      if (options.exceptSessionId !== undefined && session.id === options.exceptSessionId) {
        continue;
      }
      await this.revoke(session, reason, now, { manager: options.manager });
      revoked += 1;
    }

    return revoked;
  }

  /** The caller's live, unexpired sessions, newest first (`GET /auth/sessions`). */
  async listActive(userId: string, now: Date): Promise<Session[]> {
    const rows = await this.sessions.find({
      where: { userId, revokedAt: IsNull() },
      order: { lastSeenAt: 'DESC' },
    });
    return rows.filter((session) => !this.isExpired(session, now));
  }

  /** Retention (§4.5): rows are hard-deleted 30 days after `absoluteExpiresAt`. */
  async purgeExpiredBefore(before: Date): Promise<number> {
    const result = await this.sessions.delete({ absoluteExpiresAt: LessThan(before) });
    return result.affected ?? 0;
  }

  /**
   * Writes the session cookie — httpOnly, Secure, SameSite=Lax, scoped to the parent
   * domain so one cookie covers both the web and API origins (PRD B-6, §9.2).
   *
   * `maxAge` mirrors the role's absolute ceiling, so the browser drops the cookie no
   * later than the server drops the row.
   */
  writeSessionCookie(response: CookieWritingResponse, token: string, role: Role): void {
    response.cookie(this.config.sessionCookieName, token, this.sessionCookieOptions(role));
  }

  clearSessionCookie(response: CookieWritingResponse): void {
    response.clearCookie(this.config.sessionCookieName, this.sessionCookieOptions(Role.CONSUMER));
  }

  /** Session and CSRF cookies together — every response that starts or ends a session. */
  writeAuthCookies(response: CookieWritingResponse, issued: IssuedSession): void {
    this.writeSessionCookie(response, issued.token, issued.session.role);
    this.csrfService.writeCookie(response, issued.csrfToken);
  }

  clearAuthCookies(response: CookieWritingResponse): void {
    this.clearSessionCookie(response);
    this.csrfService.clearCookie(response);
  }

  /**
   * The repository a write should go through.
   *
   * Without a manager this is the module's own injected repository, on the pool's
   * connection. With one, it is the same table bound to the caller's open
   * transaction — the only difference that matters, and the reason a status change
   * in `users` and a revocation in `sessions` can share a commit without either
   * module touching the other's table (§2.9 rule 3).
   */
  private repositoryFor(manager?: EntityManager): Repository<Session> {
    return manager === undefined ? this.sessions : manager.getRepository(Session);
  }

  /**
   * Built from this service's own configuration rather than borrowed from
   * `CsrfService`, so the two cookies cannot silently drift apart if one of them is
   * ever constructed with a different config object.
   */
  private sessionCookieOptions(role: Role): AuthCookieOptions {
    return {
      // The one difference from the CSRF cookie, and the important one: no script on
      // any page ever reads the session value (§9.2).
      httpOnly: true,
      secure: this.config.sessionCookieSecure,
      // Lax, not Strict: a reset or verification link is a top-level navigation from
      // an email client, and Strict would drop the cookie on arrival (B-6).
      sameSite: 'lax',
      domain: this.config.sessionCookieDomain,
      path: '/',
      maxAge: this.absoluteWindowMs(role),
    };
  }
}
