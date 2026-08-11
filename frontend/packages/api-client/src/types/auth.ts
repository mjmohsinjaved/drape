

import type { IsoDateTime, Uuid } from './common';
import type { Locale, Role, UserStatus } from './enums';


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
  /** Whether a second factor is enrolled (S-8). */
  twofaEnabled: boolean;
}


export type MeResponse = SessionUser;

/** `GET /auth/csrf` (PUBLIC). Issues the `drape.csrf` cookie and returns the matching token. */
export interface CsrfTokenResponse {
  csrfToken: string;
  cookieName: string;
  headerName: string;
}


export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  phone: string;
  locale?: Locale;

  role?: string;
}

export type SignupResponse = SessionUser;

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: SessionUser | null;
  twofaRequired: boolean;
}


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
  current: boolean;
  userAgent: string | null;
  ip: string;
  createdAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

/* ------------------------------------------------------------------ two-factor (S-8) */

export interface TwoFaCodeRequest {
  code: string;
}

export interface TwoFaRecoveryRequest {
  recoveryCode: string;
}

export interface TwoFaSetupResponse {
  secret: string;
  provisioningUri: string;
}

export interface TwoFaEnableResponse {
  recoveryCodes: string[];
}

export interface TwoFaDisableRequest {
  currentPassword: string;
  code: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/* ------------------------------------------------------------------ verification (C-3) */

/** `POST /auth/email/verify/confirm` (PUBLIC). */
export interface ConfirmEmailVerificationRequest {
  token: string;
}

export interface RequestPhoneOtpRequest {
  phone?: string;
}

export interface VerifyPhoneOtpRequest {
  code: string;
}
