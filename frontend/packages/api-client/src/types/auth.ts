/**
 * ARCHITECTURE.md §5.1 `auth`.
 *
 * There are no bearer tokens anywhere in the frontend. Authentication is the `drape.sid` httpOnly
 * cookie; the only header the client adds is the CSRF token (§6.4, PRD B-6/B-8). Nothing in this
 * file returns a session token, and nothing in this file is ever written to `localStorage`.
 */

import type { IsoDateTime, Uuid } from './common';
import type { Locale, Role, UserStatus } from './enums';

/**
 * The caller's identity as `GET /auth/me` returns it — the single role-resolution call used by the
 * web middleware (B-10).
 *
 * **This is presentation state.** Authorisation is decided in the API only (S-3, B-10, CLAUDE.md).
 */
export interface SessionUser {
  id: Uuid;
  role: Role;
  email: string;
  name: string;
  phone: string | null;
  status: UserStatus;
  locale: Locale;
  emailVerifiedAt: IsoDateTime | null;
  phoneVerifiedAt: IsoDateTime | null;
  twofaEnabledAt: IsoDateTime | null;
  /** True while the session is in the `twofaPending` state — only `/auth/2fa/challenge` is reachable (S-8). */
  twofaPending: boolean;
  createdAt: IsoDateTime;
}

/** `GET /auth/me` (ANY). */
export interface MeResponse {
  user: SessionUser;
}

/** `GET /auth/csrf` (PUBLIC). Issues the `drape.csrf` cookie and returns the matching token. */
export interface CsrfTokenResponse {
  csrfToken: string;
  /** The cookie name the token was written to — `drape.csrf` by default (`CSRF_COOKIE_NAME`). */
  cookieName: string;
}

/** `POST /auth/signup` (PUBLIC, ⊘ CSRF). A `role` in the payload is stripped and audit-logged (S-4). */
export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  phone?: string;
  locale?: Locale;
  /** §8.4 bot-protection token. Absent or invalid yields `BOT_CHECK_FAILED`. */
  botCheckToken?: string;
}

export interface SignupResponse {
  user: SessionUser;
  /** True when `quota.requireEmailVerification` is on and she must confirm before her first try-on (C-3, A-28). */
  emailVerificationRequired: boolean;
}

/** `POST /auth/login` (PUBLIC, ⊘ CSRF). Sets `drape.sid`. Failure copy is generic by design (S-6). */
export interface LoginRequest {
  email: string;
  password: string;
  /** Opt into the longer S-7 idle window for this device. */
  rememberMe?: boolean;
}

export interface LoginResponse {
  user: SessionUser;
  /** True when the session is `twofaPending` and `POST /auth/2fa/challenge` must follow (S-8). */
  twofaRequired: boolean;
}

/** `POST /auth/2fa/challenge` (PUBLIC). Completes a `twofaPending` session with a TOTP code. */
export interface TwoFaChallengeRequest {
  code: string;
}

export type TwoFaChallengeResponse = LoginResponse;

/** `POST /auth/2fa/recovery` (PUBLIC). Completes a `twofaPending` session with a recovery code. */
export interface TwoFaRecoveryRequest {
  recoveryCode: string;
}

export type TwoFaRecoveryResponse = LoginResponse;

/** `POST /auth/2fa/setup` (ANY). */
export interface TwoFaSetupResponse {
  /** Base32 TOTP secret, shown once for manual entry. */
  secret: string;
  /** `otpauth://` provisioning URI, rendered as a QR code. */
  provisioningUri: string;
  issuer: string;
}

/** `POST /auth/2fa/enable` (ANY). Recovery codes are returned exactly once and never again. */
export interface TwoFaEnableRequest {
  code: string;
}

export interface TwoFaEnableResponse {
  recoveryCodes: string[];
  enabledAt: IsoDateTime;
}

/** `POST /auth/2fa/disable` (ANY). Rejected for admins with `TWOFA_REQUIRED_FOR_ROLE` (S-8). */
export interface TwoFaDisableRequest {
  /** The current password, re-asked before a security downgrade. */
  password: string;
  code?: string;
}

/** `POST /auth/logout` (ANY). Revokes the current session and clears cookies. No payload. */
export interface LogoutResponse {
  loggedOut: true;
}

/** One row of `GET /auth/sessions` (ANY) — the caller's own active sessions (§4.5). */
export interface SessionSummary {
  id: Uuid;
  /** True for the session making the request; the UI labels it "This device". */
  isCurrent: boolean;
  ip: string;
  userAgent: string | null;
  lastSeenAt: IsoDateTime;
  expiresAt: IsoDateTime;
  absoluteExpiresAt: IsoDateTime;
  createdAt: IsoDateTime;
}

/** `DELETE /auth/sessions` (ANY) — revoke all sessions other than the current one. */
export interface RevokeSessionsResponse {
  revokedCount: number;
}

/**
 * `POST /auth/password/forgot` (PUBLIC). Always 200, always this exact body, whether or not the
 * address exists (S-6).
 */
export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  /** Deliberately non-committal: "If that address has an account, a reset link is on its way." */
  sent: true;
}

/** `POST /auth/password/reset` (PUBLIC). Consumes the token, sets the password, revokes all sessions. */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}

/** `POST /auth/password/change` (ANY). Revokes every session except the current one. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  revokedSessionCount: number;
}

/** `POST /auth/email/verify/request` (ANY). Re-sends the verification email. No payload. */
export interface RequestEmailVerificationResponse {
  sent: true;
  /** When the previous link is still live, the API reports when a new one may be requested. */
  retryAfterSeconds?: number;
}

/** `POST /auth/email/verify/confirm` (PUBLIC). */
export interface ConfirmEmailVerificationRequest {
  token: string;
}

export interface ConfirmEmailVerificationResponse {
  emailVerifiedAt: IsoDateTime;
}

/** `POST /auth/phone/otp/request` (CONSUMER). C-3. */
export interface RequestPhoneOtpRequest {
  /** E.164. Omitted to re-send to the number already on the account. */
  phone?: string;
}

export interface RequestPhoneOtpResponse {
  sent: true;
  /** `OTP_TTL_SECONDS`, so the UI can render the countdown honestly. */
  expiresInSeconds: number;
}

/** `POST /auth/phone/otp/verify` (CONSUMER). Stamps `phoneVerifiedAt`. */
export interface VerifyPhoneOtpRequest {
  code: string;
}

export interface VerifyPhoneOtpResponse {
  phoneVerifiedAt: IsoDateTime;
}
