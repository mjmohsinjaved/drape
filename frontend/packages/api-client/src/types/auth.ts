/**
 * ARCHITECTURE.md §5.1 `auth`, plus the two public `invites` acceptance routes §5.3 mounts on
 * `/invites`.
 *
 * There are no bearer tokens anywhere in the frontend. Authentication is the `drape.sid` httpOnly
 * cookie; the only header the client adds is the CSRF token (§6.4, PRD B-6/B-8). Nothing in this
 * file returns a session token, and nothing in this file is ever written to `localStorage`.
 *
 * **These shapes are written against `modules/auth/dto/**` — the running API — not against the
 * §5.1 prose.** Where the two disagree the API wins (B-4): a hand-written optimism here is the
 * exact failure the typed client exists to prevent.
 */

import type { IsoDateTime, Uuid } from './common';
import type { Locale, Role, UserStatus } from './enums';

/**
 * `AuthUserDto` — the body of `GET /auth/me`, `POST /auth/signup` and
 * `POST /invites/token/:token/accept`.
 *
 * **This is presentation state.** It selects which interface renders and is never an
 * authorisation decision (S-3, B-10, CLAUDE.md): the API re-reads the role on every request.
 */
export interface SessionUser {
  id: Uuid;
  role: Role;
  email: string;
  name: string;
  status: UserStatus;
  emailVerifiedAt: IsoDateTime | null;
  phoneVerifiedAt: IsoDateTime | null;
  /** E.164, masked to the last four digits — even for the owner. */
  phone: string | null;
  locale: Locale;
}

/**
 * `GET /auth/me` (ANY) — the single role-resolution call the web middleware makes (B-10).
 *
 * The DTO is returned **bare**, not wrapped in `{ user }`. The §2.3 envelope is the only wrapper
 * on the wire, and the response interceptor has already lifted it off.
 */
export type MeResponse = SessionUser;

/** `GET /auth/csrf` (PUBLIC). Issues the `drape.csrf` cookie and returns the matching token. */
export interface CsrfTokenResponse {
  csrfToken: string;
  /** The cookie the token was written to — `drape.csrf` by default. */
  cookieName: string;
  /** The header the API expects it back in — `X-CSRF-Token`. */
  headerName: string;
}

/* ------------------------------------------------------------------ signup and login */

/**
 * `POST /auth/signup` (PUBLIC, ⊘ CSRF). C-2: name, email, password and phone. Event date, event
 * type and budget band are prompted later, in context, and are not part of this payload.
 *
 * There is no `botCheckToken`: the §8.4 check is not wired to a client-supplied token.
 */
export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  /** E.164, e.g. `+923001234567`. Required — the DTO has no optional marker on it. */
  phone: string;
  locale?: Locale;
  /**
   * **Accepted and ignored (S-4).** Declared only because the global pipe runs with
   * `forbidNonWhitelisted`, so an undeclared property would 400 rather than be stripped. The
   * value is audit-logged and the account is always a Consumer. No client should send it.
   *
   * @deprecated Never send this.
   */
  role?: string;
}

/** `POST /auth/signup` answers the created Consumer directly — there is no wrapper object. */
export type SignupResponse = SessionUser;

/**
 * `POST /auth/login` (PUBLIC, ⊘ CSRF). Sets `drape.sid`. Failure copy is generic by design (S-6).
 *
 * There is no `rememberMe`: the S-7 idle window is chosen by role, server-side, and is not a
 * client preference.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * `POST /auth/login`.
 *
 * A password is the only credential, so a successful login resolves the caller outright —
 * there is no intermediate state and `user` is never null on a 2xx.
 */
export interface LoginResponse {
  user: SessionUser;
}

/* ------------------------------------------------------------------ acknowledgement */

/**
 * `AuthAcknowledgementDto` — the single body returned by logout, session revocation, password
 * reset, password change, email verification, phone OTP and 2FA disable.
 *
 * It is deliberately contentless. S-6 requires the bytes to be identical whether or not the
 * address belongs to an account, so there is nothing here for a caller to branch on and the UI
 * must not imply that there was. In particular the API does **not** send `sent`,
 * `emailVerifiedAt`, `phoneVerifiedAt`, `revokedSessionCount`, `revokedCount` or
 * `expiresInSeconds` on any of these routes.
 */
export interface AuthAcknowledgement {
  accepted: boolean;
  /** Present only where the outcome is not a secret. Never rendered raw — the API owns the copy. */
  detail?: string;
}

/** `POST /auth/logout` (ANY). Revokes the current session and clears both cookies. */
export type LogoutResponse = AuthAcknowledgement;

/** `DELETE /auth/sessions` (ANY) — revoke every session other than the current one. */
export type RevokeSessionsResponse = AuthAcknowledgement;

/* ------------------------------------------------------------------ sessions */

/** One row of `GET /auth/sessions` (ANY) — the caller's own active sessions (§4.5). */
export interface SessionSummary {
  id: Uuid;
  /** True for the session making the request; the UI labels it "This device". */
  current: boolean;
  userAgent: string | null;
  /** Already truncated server-side: the last octet or group is dropped (E-12). */
  ip: string;
  createdAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

/* ------------------------------------------------------------------ passwords */

/**
 * `POST /auth/password/forgot` (PUBLIC). Always 200, always {@link AuthAcknowledgement}, whether
 * or not the address exists (S-6).
 */
export interface ForgotPasswordRequest {
  email: string;
}

/** `POST /auth/password/reset` (PUBLIC). Consumes the token, sets the password, revokes all sessions. */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}

/** `POST /auth/password/change` (ANY). Rotates this session and revokes every other one. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/* ------------------------------------------------------------------ verification (C-3) */

/** `POST /auth/email/verify/confirm` (PUBLIC). */
export interface ConfirmEmailVerificationRequest {
  token: string;
}

/** `POST /auth/phone/otp/request` (CONSUMER). C-3. */
export interface RequestPhoneOtpRequest {
  /** E.164. Omitted to re-send to the number already on the account. */
  phone?: string;
}

/** `POST /auth/phone/otp/verify` (CONSUMER). Stamps `phoneVerifiedAt`. */
export interface VerifyPhoneOtpRequest {
  code: string;
}
