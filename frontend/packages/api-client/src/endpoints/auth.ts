/**
 * `auth` — ARCHITECTURE.md §5.1, plus the two public acceptance routes §5.3 mounts on `/invites`.
 *
 * Paths are relative to `NEXT_PUBLIC_API_BASE_URL`, which already carries `/api/v1`.
 *
 * `authPaths` is exported because Server Components read through their own cookie-forwarding
 * helper and need the string, not the browser call. Everything else in the app goes through the
 * functions.
 */

import { del, get, post, segment, type EndpointOptions } from './http';

import type {
  AuthAcknowledgement,
  ChangePasswordRequest,
  ConfirmEmailVerificationRequest,
  CsrfTokenResponse,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  RequestPhoneOtpRequest,
  ResetPasswordRequest,
  RevokeSessionsResponse,
  SessionSummary,
  SignupRequest,
  SignupResponse,
  VerifyPhoneOtpRequest,
} from '../types/auth';
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  InviteTokenPreview,
} from '../types/invites';

export const authPaths = {
  csrf: '/auth/csrf',
  me: '/auth/me',
  signup: '/auth/signup',
  login: '/auth/login',
  logout: '/auth/logout',

  passwordForgot: '/auth/password/forgot',
  passwordReset: '/auth/password/reset',
  passwordChange: '/auth/password/change',

  emailVerifyRequest: '/auth/email/verify/request',
  emailVerifyConfirm: '/auth/email/verify/confirm',

  phoneOtpRequest: '/auth/phone/otp/request',
  phoneOtpVerify: '/auth/phone/otp/verify',

  sessions: '/auth/sessions',
  session: (sessionId: string): string => `/auth/sessions/${segment(sessionId)}`,

  /** `GET /invites/token/:token` (PUBLIC) — validates a token for the acceptance form (S-5). */
  invitePreview: (token: string): string => `/invites/token/${segment(token)}`,
  /** `POST /invites/token/:token/accept` (PUBLIC) — creates the admin account (S-5). */
  inviteAccept: (token: string): string => `/invites/token/${segment(token)}/accept`,
} as const;

/* ------------------------------------------------------------------ session lifecycle */

/** `GET /auth/csrf` (PUBLIC). Prefer `ensureCsrf()` — it de-duplicates concurrent callers. */
export async function getCsrfToken(options?: EndpointOptions): Promise<CsrfTokenResponse> {
  return get<CsrfTokenResponse>(authPaths.csrf, options);
}

/**
 * `GET /auth/me` (ANY) — the single role-resolution call (B-10).
 *
 * **Presentation state only.** It decides which shell renders, never whether an action is
 * permitted; the API re-reads the role on every request (S-3).
 */
export async function getSession(options?: EndpointOptions): Promise<MeResponse> {
  return get<MeResponse>(authPaths.me, options);
}

/** `POST /auth/signup` (PUBLIC, ⊘ CSRF) — always a Consumer account (S-4). */
export async function signup(
  body: SignupRequest,
  options?: EndpointOptions,
): Promise<SignupResponse> {
  return post<SignupResponse, SignupRequest>(authPaths.signup, body, options);
}

/** `POST /auth/login` (PUBLIC, ⊘ CSRF) — generic failure copy (S-6). Sets `drape.sid`. */
export async function login(body: LoginRequest, options?: EndpointOptions): Promise<LoginResponse> {
  return post<LoginResponse, LoginRequest>(authPaths.login, body, options);
}

/** `POST /auth/logout` (ANY). Revokes this session and clears both cookies. */
export async function logout(options?: EndpointOptions): Promise<LogoutResponse> {
  return post<LogoutResponse>(authPaths.logout, undefined, options);
}

/* ------------------------------------------------------------------ passwords */

/**
 * `POST /auth/password/forgot` (PUBLIC).
 *
 * Always 200 and always the same body, whether or not the address exists (S-6). The screen that
 * calls this must confirm in wording that does not imply either outcome.
 */
export async function forgotPassword(
  body: ForgotPasswordRequest,
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return post<AuthAcknowledgement, ForgotPasswordRequest>(
    authPaths.passwordForgot,
    body,
    options,
  );
}

/** `POST /auth/password/reset` (PUBLIC) — single-use 30-minute token; revokes every session. */
export async function resetPassword(
  body: ResetPasswordRequest,
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return post<AuthAcknowledgement, ResetPasswordRequest>(authPaths.passwordReset, body, options);
}

/** `POST /auth/password/change` (ANY) — C-7. Keeps this session, revokes the others. */
export async function changePassword(
  body: ChangePasswordRequest,
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return post<AuthAcknowledgement, ChangePasswordRequest>(authPaths.passwordChange, body, options);
}

/* ------------------------------------------------------------------ verification (C-3) */

/** `POST /auth/email/verify/request` (ANY) — re-sends the verification email. */
export async function requestEmailVerification(
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return post<AuthAcknowledgement>(authPaths.emailVerifyRequest, undefined, options);
}

/** `POST /auth/email/verify/confirm` (PUBLIC) — consumes the emailed token. */
export async function confirmEmailVerification(
  body: ConfirmEmailVerificationRequest,
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return post<AuthAcknowledgement, ConfirmEmailVerificationRequest>(
    authPaths.emailVerifyConfirm,
    body,
    options,
  );
}

/** `POST /auth/phone/otp/request` (CONSUMER) — C-3, required before an enquiry. */
export async function requestPhoneOtp(
  body: RequestPhoneOtpRequest,
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return post<AuthAcknowledgement, RequestPhoneOtpRequest>(authPaths.phoneOtpRequest, body, options);
}

/** `POST /auth/phone/otp/verify` (CONSUMER) — stamps `phoneVerifiedAt`. */
export async function verifyPhoneOtp(
  body: VerifyPhoneOtpRequest,
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return post<AuthAcknowledgement, VerifyPhoneOtpRequest>(authPaths.phoneOtpVerify, body, options);
}

/* ------------------------------------------------------------------ sessions (§4.5) */

/** `GET /auth/sessions` (ANY) — the caller's own live sessions. Not paginated. */
export async function listSessions(options?: EndpointOptions): Promise<SessionSummary[]> {
  return get<SessionSummary[]>(authPaths.sessions, options);
}

/** `DELETE /auth/sessions/:sessionId` (ANY) — revokes one of the caller's own devices. */
export async function revokeSession(
  sessionId: string,
  options?: EndpointOptions,
): Promise<AuthAcknowledgement> {
  return del<AuthAcknowledgement>(authPaths.session(sessionId), options);
}

/** `DELETE /auth/sessions` (ANY) — everything except this device. */
export async function revokeOtherSessions(
  options?: EndpointOptions,
): Promise<RevokeSessionsResponse> {
  return del<RevokeSessionsResponse>(authPaths.sessions, options);
}

/* ------------------------------------------------------------------ invite acceptance (S-5) */

/** `GET /invites/token/:token` (PUBLIC) — read-only, so the acceptance form can be reloaded. */
export async function previewInviteToken(
  token: string,
  options?: EndpointOptions,
): Promise<InviteTokenPreview> {
  return get<InviteTokenPreview>(authPaths.invitePreview(token), options);
}

/**
 * `POST /invites/token/:token/accept` (PUBLIC) — creates the admin account behind an invitation.
 *
 * The token is an argument rather than a body field, and the body carries no role and no email:
 * both come from the invite row the token resolves to (S-4, S-5).
 */
export async function acceptInvite(
  token: string,
  body: AcceptInviteRequest,
  options?: EndpointOptions,
): Promise<AcceptInviteResponse> {
  return post<AcceptInviteResponse, AcceptInviteRequest>(
    authPaths.inviteAccept(token),
    body,
    options,
  );
}
