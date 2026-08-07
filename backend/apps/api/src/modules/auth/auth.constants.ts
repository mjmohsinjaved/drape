/**
 * Auth module constants — ARCHITECTURE §4.5, §4.6, §4.7, §5.1, §5.22.
 *
 * Injection tokens are `Symbol`s so they cannot collide with a string token bound
 * elsewhere, matching `SESSION_RESOLVER` in `@library/common`.
 */

/** Resolved §7 configuration for this module. Bound by `AuthModule`. */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/**
 * The narrow `users` seam this module depends on.
 *
 * Auth owns sessions, tokens and attempts; it does **not** own `users` (§4.33), and
 * §2.9 rule 5 forbids reaching into another module's repository. The `users` module
 * binds an implementation of `UserDirectory` to this token.
 */
export const USER_DIRECTORY = Symbol('USER_DIRECTORY');

/**
 * The second, deliberately separate `users` seam: creating the account behind an
 * accepted invitation.
 *
 * It is not a method on `UserDirectory` because that interface's guarantee is
 * structural — "there is no `role` field, by construction" (S-4) — and adding an
 * admin-creating method to it would end that guarantee for every one of its callers.
 * A distinct token, a distinct interface and a distinct implementation class mean the
 * object bound to {@link USER_DIRECTORY} has no way to mint an admin at all, while
 * `POST /invites/token/:token/accept` — the one endpoint S-5 allows to — injects this
 * instead.
 */
export const INVITED_ACCOUNT_DIRECTORY = Symbol('INVITED_ACCOUNT_DIRECTORY');

/**
 * `auth_attempts.route` — the closed set of values this application *writes*.
 *
 * `TWOFA` was one of them until two-factor sign-in was removed. Rows written before
 * then still carry it and are still read by the S-6 backoff and the E-14 anomaly
 * sweep; the ledger is append-only, so nothing rewrites them. It is absent here
 * because nothing may write it again.
 */
export const AUTH_ROUTES = {
  LOGIN: 'LOGIN',
  SIGNUP: 'SIGNUP',
  PASSWORD_RESET: 'PASSWORD_RESET',
  OTP: 'OTP',
} as const;

export type AuthRoute = (typeof AUTH_ROUTES)[keyof typeof AUTH_ROUTES];

/** `sessions.revokedReason` — the closed set from §4.5. */
export const REVOKE_REASONS = {
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  DEACTIVATED: 'DEACTIVATED',
  SUSPENDED: 'SUSPENDED',
  ADMIN_REVOKED: 'ADMIN_REVOKED',
  /** Privilege change: login and password change mint a new id and retire the old one. */
  ROTATED: 'ROTATED',
} as const;

export type RevokeReason = (typeof REVOKE_REASONS)[keyof typeof REVOKE_REASONS];

/**
 * How stale `lastSeenAt` is allowed to get before the resolver writes it.
 *
 * §2.7 asks guard 3 to slide `expiresAt` and update `lastSeenAt` on every request.
 * Doing that literally turns every GET into a write. The idle windows are 12 hours
 * and 30 days (S-7), so deferring the write for a minute cannot expire a live
 * session, and it keeps a busy consumer to one UPDATE a minute instead of hundreds.
 */
export const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

/** The S-6 failure window: five failures *inside fifteen minutes* trigger lockout. */
export const LOCKOUT_WINDOW_MINUTES = 15;

/** Wrong OTP entries allowed against one code before it is burned (`OTP_MAX_ATTEMPTS`). */
export const OTP_MAX_ATTEMPTS = 5;

/** Digits in a phone OTP (C-3). */
export const OTP_DIGITS = 6;

/** PASSWORD_POLICY_VIOLATION copy: "at least 10 characters, including a number and a symbol". */
export const PASSWORD_MIN_LENGTH = 10;

/** Argon2 refuses absurd inputs, and hashing an unbounded string is a DoS vector. */
export const PASSWORD_MAX_LENGTH = 200;

/** Entropy of the opaque session cookie value, in bytes. §4.5 specifies 32. */
export const SESSION_TOKEN_BYTES = 32;

/** Entropy of an emailed verification/reset token, in bytes. */
export const VERIFICATION_TOKEN_BYTES = 32;
