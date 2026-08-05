import type { Role } from '@library/common';

/**
 * Domain events this module emits — `domain.action` (§2.2).
 *
 * Audit rows are written by an `@OnEvent` listener in the `audit` module, never
 * inline here (§2.9 rule 4), so each payload carries exactly what an `audit_log`
 * row needs and nothing more. **No payload ever carries a password, a token, an OTP
 * or a raw email address** (E-12) — the signup event carries the new user's id, and
 * the actor is looked up from it.
 */
export const AUTH_EVENTS = {
  /** S-4: a `role` field in a signup payload was stripped. Audited as `SIGNUP_ROLE_IGNORED`. */
  SIGNUP_ROLE_IGNORED: 'auth.signup_role_ignored',
  SIGNED_UP: 'auth.signed_up',
  LOGGED_IN: 'auth.logged_in',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_CHANGED: 'auth.password_changed',
  EMAIL_VERIFIED: 'auth.email_verified',
  PHONE_VERIFIED: 'auth.phone_verified',
  TWOFA_ENABLED: 'auth.twofa_enabled',
  TWOFA_DISABLED: 'auth.twofa_disabled',
  /**
   * S-6/S-8: a pending session burned through its second-factor guessing budget and
   * was revoked. Worth an audit row and an operator alert — repeated occurrences on
   * one account mean the password is already known to somebody else.
   */
  TWOFA_CHALLENGE_LOCKED: 'auth.twofa_challenge_locked',
  SESSIONS_REVOKED: 'auth.sessions_revoked',
} as const;

export type AuthEventName = (typeof AUTH_EVENTS)[keyof typeof AUTH_EVENTS];

/** Fields every auth event carries, so the audit listener needs no special cases. */
export interface AuthEventBase {
  readonly userId: string;
  readonly role: Role;
  readonly ip: string;
  readonly userAgent: string | null;
  readonly occurredAt: Date;
}

/**
 * S-4. `requestedRole` is the **raw string the client sent**, kept verbatim so the
 * audit row shows what was attempted. It is never used to decide anything.
 */
export interface SignupRoleIgnoredEvent extends AuthEventBase {
  readonly requestedRole: string;
  /** The role actually created. Always `Role.CONSUMER`. */
  readonly createdRole: Role;
}

export interface SignedUpEvent extends AuthEventBase {
  readonly locale: string;
}

export interface LoggedInEvent extends AuthEventBase {
  readonly sessionId: string;
  readonly twofaRequired: boolean;
}

export interface SessionsRevokedEvent extends AuthEventBase {
  readonly reason: string;
  readonly revokedCount: number;
}

/** The revoked pending session and how many consecutive wrong codes it took. */
export interface TwoFactorChallengeLockedEvent extends AuthEventBase {
  readonly failureCount: number;
  readonly sessionId: string;
}

/** Events with no payload beyond the base — password change, verification, 2FA. */
export type AuthAccountEvent = AuthEventBase;
