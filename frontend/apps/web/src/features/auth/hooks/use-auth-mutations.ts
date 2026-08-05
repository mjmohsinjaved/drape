'use client';

import { ensureCsrf, queryKeys, useApiMutation, type ApiError } from '@repo/api-client';

import { authApi } from '@/features/auth/api/paths';

import type {
  AcceptInviteBody,
  AuthAcknowledgement,
  AuthUser,
  ChangePasswordBody,
  ConfirmEmailBody,
  DisableTwoFactorBody,
  ForgotPasswordBody,
  LoginBody,
  LoginResult,
  RequestPhoneOtpBody,
  ResetPasswordBody,
  SignupBody,
  TwoFactorCodeBody,
  TwoFactorEnabled,
  TwoFactorRecoveryBody,
  TwoFactorSetup,
} from '@/features/auth/api/types';
import type { UseMutationResult } from '@tanstack/react-query';

/**
 * The §5.1 mutations, as feature hooks (§6.4).
 *
 * Every one of them goes through `useApiMutation` from `@repo/api-client`, so the envelope is
 * unwrapped, the failure is already an `ApiError`, and the CSRF and request-id headers are
 * added by the package's request interceptor. There is no axios instance and no `fetch` in
 * this feature.
 *
 * `onMutate` primes the double-submit cookie first (B-8). `GET /auth/csrf` is called once per
 * page load and concurrent callers share the one in-flight request, so this is free after the
 * first mutation. Login and signup carry `@SkipCsrf()` server-side and would work without it —
 * they still prime, because the cookie they end up holding is the one every later mutation on
 * the page needs.
 */
async function primeCsrf(): Promise<void> {
  await ensureCsrf();
}

type Mutation<TData, TVariables> = UseMutationResult<TData, ApiError, TVariables>;

/** `POST /auth/login` — S-1, S-6. Answers `{ user, twofaRequired }`. */
export function useLogin(): Mutation<LoginResult, LoginBody> {
  return useApiMutation<LoginResult, LoginBody>({
    url: authApi.login,
    onMutate: primeCsrf,
    // A new session means a new identity; nothing cached under the old one still applies.
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/signup` — always a Consumer account (S-4). */
export function useSignup(): Mutation<AuthUser, SignupBody> {
  return useApiMutation<AuthUser, SignupBody>({
    url: authApi.signup,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/2fa/challenge` — completes a `twofaPending` session with a TOTP code (S-8). */
export function useTwoFactorChallenge(): Mutation<LoginResult, TwoFactorCodeBody> {
  return useApiMutation<LoginResult, TwoFactorCodeBody>({
    url: authApi.twoFactorChallenge,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/2fa/recovery` — the same completion with a single-use code (S-8). */
export function useTwoFactorRecovery(): Mutation<LoginResult, TwoFactorRecoveryBody> {
  return useApiMutation<LoginResult, TwoFactorRecoveryBody>({
    url: authApi.twoFactorRecovery,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/logout` — revokes this session and clears both cookies. */
export function useLogout(): Mutation<AuthAcknowledgement, void> {
  return useApiMutation<AuthAcknowledgement, void>({
    url: authApi.logout,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all, queryKeys.me.all],
  });
}

/**
 * `POST /auth/password/forgot` — S-6.
 *
 * Always 200, always the same body, whether or not the address exists. The screen that calls
 * this must confirm in wording that does not imply either outcome.
 */
export function useForgotPassword(): Mutation<AuthAcknowledgement, ForgotPasswordBody> {
  return useApiMutation<AuthAcknowledgement, ForgotPasswordBody>({
    url: authApi.passwordForgot,
    onMutate: primeCsrf,
  });
}

/** `POST /auth/password/reset` — single-use 30-minute token; revokes every session (S-6). */
export function useResetPassword(): Mutation<AuthAcknowledgement, ResetPasswordBody> {
  return useApiMutation<AuthAcknowledgement, ResetPasswordBody>({
    url: authApi.passwordReset,
    onMutate: primeCsrf,
  });
}

/** `POST /auth/password/change` — C-7. Keeps this session, revokes the others. */
export function useChangePassword(): Mutation<AuthAcknowledgement, ChangePasswordBody> {
  return useApiMutation<AuthAcknowledgement, ChangePasswordBody>({
    url: authApi.passwordChange,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.sessions()],
  });
}

/** `POST /auth/email/verify/request` — re-sends the link (C-3). */
export function useRequestEmailVerification(): Mutation<AuthAcknowledgement, void> {
  return useApiMutation<AuthAcknowledgement, void>({
    url: authApi.emailVerifyRequest,
    onMutate: primeCsrf,
  });
}

/** `POST /auth/email/verify/confirm` — consumes the emailed token (C-3). */
export function useConfirmEmail(): Mutation<AuthAcknowledgement, ConfirmEmailBody> {
  return useApiMutation<AuthAcknowledgement, ConfirmEmailBody>({
    url: authApi.emailVerifyConfirm,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.me(), queryKeys.me.account()],
  });
}

/** `POST /auth/phone/otp/request` — C-3, required before an enquiry. */
export function useRequestPhoneOtp(): Mutation<AuthAcknowledgement, RequestPhoneOtpBody> {
  return useApiMutation<AuthAcknowledgement, RequestPhoneOtpBody>({
    url: authApi.phoneOtpRequest,
    onMutate: primeCsrf,
  });
}

/** `POST /auth/phone/otp/verify` — stamps `phoneVerifiedAt` (C-3). */
export function useVerifyPhoneOtp(): Mutation<AuthAcknowledgement, TwoFactorCodeBody> {
  return useApiMutation<AuthAcknowledgement, TwoFactorCodeBody>({
    url: authApi.phoneOtpVerify,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.me(), queryKeys.me.account()],
  });
}

/** `POST /auth/2fa/setup` — returns the secret and the provisioning URI, before confirmation. */
export function useTwoFactorSetup(): Mutation<TwoFactorSetup, void> {
  return useApiMutation<TwoFactorSetup, void>({
    url: authApi.twoFactorSetup,
    onMutate: primeCsrf,
  });
}

/** `POST /auth/2fa/enable` — confirms a code and returns the recovery codes exactly once. */
export function useTwoFactorEnable(): Mutation<TwoFactorEnabled, TwoFactorCodeBody> {
  return useApiMutation<TwoFactorEnabled, TwoFactorCodeBody>({
    url: authApi.twoFactorEnable,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.me(), queryKeys.me.account()],
  });
}

/** `POST /auth/2fa/disable` — refused for admins with `TWOFA_REQUIRED_FOR_ROLE` (S-8). */
export function useTwoFactorDisable(): Mutation<AuthAcknowledgement, DisableTwoFactorBody> {
  return useApiMutation<AuthAcknowledgement, DisableTwoFactorBody>({
    url: authApi.twoFactorDisable,
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.me(), queryKeys.me.account()],
  });
}

/**
 * `POST /invites/token/:token/accept` — creates the admin account behind an invitation (S-5).
 *
 * The token is a closure argument rather than a body field, and the body carries no role and
 * no email: both come from the invite row the token resolves to.
 */
export function useAcceptInvite(token: string): Mutation<AuthUser, AcceptInviteBody> {
  return useApiMutation<AuthUser, AcceptInviteBody>({
    url: authApi.inviteAccept(token),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}
