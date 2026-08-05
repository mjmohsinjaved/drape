import type { Locale, Role, UserStatus } from '@repo/api-client';

/**
 * The wire shapes of `auth` (§5.1) and the two public `invites` routes (§5.3), **as the API
 * actually serialises them today**.
 *
 * These are written against the NestJS DTOs rather than against `@repo/api-client`'s
 * `types/auth.ts`, because the two disagree on several routes and the running API is what the
 * browser has to parse. Each divergence is marked `CONTRACT` below and is reported alongside
 * this work; when the package catches up, these aliases collapse into re-exports.
 *
 * The enum unions themselves (`Role`, `UserStatus`, `Locale`) do agree, so they come from the
 * package — there is no second copy of the §4.1 registry here.
 */

/**
 * `AuthUserDto` — the body of `GET /auth/me`, `POST /auth/signup` and
 * `POST /invites/token/:token/accept`.
 *
 * **This is presentation state.** It selects which interface renders and is never an
 * authorisation decision (S-3, B-10): the API re-reads the role on every request.
 *
 * CONTRACT: `@repo/api-client`'s `SessionUser` declares `twofaEnabledAt`, `twofaPending` and
 * `createdAt`. The DTO carries a boolean `twofaEnabled` and neither of the other two.
 */
export interface AuthUser {
  id: string;
  role: Role;
  email: string;
  name: string;
  status: UserStatus;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  /** Masked to the last four digits, even for the owner. */
  phone: string | null;
  locale: Locale;
  twofaEnabled: boolean;
}

/**
 * `LoginResponseDto` — `POST /auth/login`, `POST /auth/2fa/challenge`, `POST /auth/2fa/recovery`.
 *
 * `user` is `null` while `twofaRequired` is true: the session exists but is `twofaPending`, and
 * nothing about the account is disclosed until the second factor lands (S-8).
 */
export interface LoginResult {
  user: AuthUser | null;
  twofaRequired: boolean;
}

/**
 * `AuthAcknowledgementDto` — the single body returned by password reset, email verification,
 * phone OTP, logout and session revocation.
 *
 * It is deliberately contentless. S-6 requires the bytes to be identical whether or not the
 * address belongs to an account, so there is nothing here for a caller to branch on and the UI
 * must not imply that there was.
 *
 * CONTRACT: the package types promise `{ sent: true }`, `{ emailVerifiedAt }`,
 * `{ phoneVerifiedAt }`, `{ revokedSessionCount }`, `{ expiresInSeconds }` and
 * `{ revokedCount }` on these routes. None of them is sent.
 */
export interface AuthAcknowledgement {
  accepted: boolean;
  /** Present only where the outcome is not a secret. Never rendered raw — see `useErrorCopy`. */
  detail?: string;
}

/**
 * `TwoFactorSetupDto` — `POST /auth/2fa/setup`.
 *
 * CONTRACT: the API returns the `otpauth://` **URI**, not a rendered QR image, and no `issuer`
 * field (the package type declares one). The enrolment screen therefore offers the URI as a
 * one-tap handoff to the authenticator app plus the secret for manual entry.
 */
export interface TwoFactorSetup {
  secret: string;
  provisioningUri: string;
}

/** `TwoFactorEnabledDto` — `POST /auth/2fa/enable`. Shown once and never again (S-8). */
export interface TwoFactorEnabled {
  recoveryCodes: string[];
}

/**
 * One row of `GET /auth/sessions`.
 *
 * CONTRACT: the field is `current`, not `isCurrent`, and there is no `absoluteExpiresAt`.
 */
export interface SessionSummary {
  id: string;
  current: boolean;
  userAgent: string | null;
  /** Already truncated server-side: the last octet or group is dropped (E-12). */
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/**
 * `InviteTokenPreviewResponseDto` — `GET /invites/token/:token`.
 *
 * Three facts and nothing more: which address, what role, when it lapses. The role is read
 * from the invite row and is never a form field (S-5).
 *
 * CONTRACT: the package type declares `invitedByName`; the DTO deliberately omits it.
 */
export interface InvitePreview {
  email: string;
  role: Role;
  expiresAt: string;
}

/* ------------------------------------------------------------------ request bodies */

/** CONTRACT: `LoginDto` has no `rememberMe`; the S-7 window is chosen by role server-side. */
export interface LoginBody {
  email: string;
  password: string;
}

/**
 * C-2: name, email, password and phone. Event date, event type and budget band are prompted
 * later, in context, and are not part of this payload.
 *
 * CONTRACT: `SignupDto` has no `botCheckToken`; the §8.4 check is not wired to a client token.
 */
export interface SignupBody {
  name: string;
  email: string;
  password: string;
  /** E.164, e.g. `+923001234567`. */
  phone: string;
  locale?: Locale;
}

export interface ForgotPasswordBody {
  email: string;
}

export interface ResetPasswordBody {
  token: string;
  password: string;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

export interface ConfirmEmailBody {
  token: string;
}

export interface RequestPhoneOtpBody {
  /** Omitted to re-send to the number already on the account. */
  phone?: string;
}

export interface TwoFactorCodeBody {
  code: string;
}

export interface TwoFactorRecoveryBody {
  recoveryCode: string;
}

/**
 * CONTRACT: `DisableTwoFactorDto` names the field `currentPassword` and requires a live `code`;
 * the package type calls it `password` and makes the code optional.
 */
export interface DisableTwoFactorBody {
  currentPassword: string;
  code: string;
}

/**
 * `AcceptInviteDto`. The email and the role come from the invite row — there is no field here
 * that could carry either, which is what makes the escalation impossible rather than merely
 * unlikely (S-4, S-5).
 *
 * CONTRACT: the package type declares `phone`; the DTO takes `locale` and rejects `phone`.
 */
export interface AcceptInviteBody {
  name: string;
  password: string;
  locale?: Locale;
}
