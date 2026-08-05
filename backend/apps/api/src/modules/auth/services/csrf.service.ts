import { Inject, Injectable } from '@nestjs/common';

import { hmacSign, hmacVerify, randomHex } from '@library/common';

import { AUTH_CONFIG } from '../auth.constants';

import type { AuthConfig } from '../config/auth.config';

/**
 * The scope a token carries before the caller has a session — the login and signup
 * forms. It is a literal, not a secret: an anonymous token proves only that the
 * request came from a page this API served, which is all CSRF needs at that point.
 */
export const ANONYMOUS_CSRF_SCOPE = 'anonymous';

/** Domain separator, so a CSRF signature can never be replayed as a file or upload one. */
const CSRF_HMAC_DOMAIN = 'csrf:';

/** Entropy of the per-token nonce, in bytes. */
const CSRF_NONCE_BYTES = 16;

/** Cookie options shared by the session and CSRF cookies (PRD B-6, §9.2). */
export interface AuthCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  domain: string;
  path: string;
  maxAge?: number;
}

/** The slice of an Express response this module writes to. */
export interface CookieWritingResponse {
  cookie(name: string, value: string, options: AuthCookieOptions): unknown;
  clearCookie(name: string, options: AuthCookieOptions): unknown;
}

/**
 * The double-submit CSRF token — ARCHITECTURE §2.7 guard 1, PRD B-8, §9.2.
 *
 * ### The gap this closes
 *
 * `CsrfGuard` in `@library/common` compares the `X-CSRF-Token` header against the
 * `drape.csrf` cookie in constant time, and stops there — it runs **before**
 * `SessionAuthGuard`, so the `sessions.csrfSecret` it would need does not exist yet,
 * and reordering the fixed chain to fetch one is not an option. Its own doc comment
 * says as much and defers the second half to this module.
 *
 * This is that second half. A token is
 *
 * ```
 * <nonce> "." HMAC-SHA256( "csrf:" + nonce + ":" + scope , CSRF_SECRET )
 * ```
 *
 * where `scope` is the session's `csrfSecret` once one exists, and
 * `"anonymous"` before that. Guard 1 proves the header and the cookie agree; the
 * `SessionCsrfBindingGuard` in this module proves — once the session is known —
 * that the pair was minted *for that session*. Together they give the §2.7 property:
 * a token lifted from another session, or forged without `CSRF_SECRET`, fails.
 *
 * Because the binding is to the session, **every privilege change re-issues the
 * cookie**: login, 2FA completion and password change all rotate the session id
 * (§4.5), and an unrotated CSRF cookie would stop verifying a moment later.
 */
@Injectable()
export class CsrfService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  /** A fresh `sessions.csrfSecret` — 32 random bytes as 64 hex characters (§4.5). */
  newSessionSecret(): string {
    return randomHex(32);
  }

  /**
   * Mints a token bound to `sessionCsrfSecret`, or an anonymous one when the caller
   * has no session yet.
   */
  issueToken(sessionCsrfSecret: string | null): string {
    const nonce = randomHex(CSRF_NONCE_BYTES);
    return `${nonce}.${this.sign(nonce, sessionCsrfSecret)}`;
  }

  /**
   * True when `token` was minted for this session (or, when
   * `sessionCsrfSecret` is `null`, for an anonymous caller).
   *
   * Constant-time via `hmacVerify`. A malformed token is `false`, never a throw —
   * the guard turns it into `CSRF_TOKEN_INVALID` like any other mismatch.
   */
  verifyToken(token: string | undefined, sessionCsrfSecret: string | null): boolean {
    if (typeof token !== 'string') {
      return false;
    }
    const separator = token.indexOf('.');
    if (separator <= 0 || separator === token.length - 1) {
      return false;
    }
    const nonce = token.slice(0, separator);
    const signature = token.slice(separator + 1);

    return hmacVerify(this.payload(nonce, sessionCsrfSecret), signature, this.config.csrfSecret, {
      domain: CSRF_HMAC_DOMAIN,
    });
  }

  /**
   * Writes the readable double-submit cookie.
   *
   * `httpOnly` is deliberately **false** — the browser client has to read this value
   * to echo it in the `X-CSRF-Token` header, and that is the whole double-submit
   * construction (B-8). It carries no authority on its own: the session lives in a
   * separate `httpOnly` cookie, and possession of this token alone signs nobody in.
   */
  writeCookie(response: CookieWritingResponse, token: string): void {
    response.cookie(this.config.csrfCookieName, token, this.cookieOptions());
  }

  clearCookie(response: CookieWritingResponse): void {
    response.clearCookie(this.config.csrfCookieName, this.cookieOptions());
  }

  /** Cookie options, exposed so the session cookie can be built from the same base. */
  cookieOptions(): AuthCookieOptions {
    return {
      httpOnly: false,
      secure: this.config.sessionCookieSecure,
      // Lax, not Strict: the reset and verification links are top-level navigations
      // from an email client, and Strict would drop the cookie on arrival (B-6).
      sameSite: 'lax',
      domain: this.config.sessionCookieDomain,
      path: '/',
    };
  }

  private sign(nonce: string, sessionCsrfSecret: string | null): string {
    return hmacSign(this.payload(nonce, sessionCsrfSecret), this.config.csrfSecret, {
      domain: CSRF_HMAC_DOMAIN,
    });
  }

  private payload(nonce: string, sessionCsrfSecret: string | null): string {
    return `${nonce}:${sessionCsrfSecret ?? ANONYMOUS_CSRF_SCOPE}`;
  }
}
