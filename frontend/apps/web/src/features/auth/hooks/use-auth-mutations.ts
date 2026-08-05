'use client';

import { authApi, ensureCsrf, queryKeys, useApiMutation, type ApiError ,type 
  AcceptInviteRequest,type 
  AuthAcknowledgement,type 
  ChangePasswordRequest,type 
  ConfirmEmailVerificationRequest,type 
  ForgotPasswordRequest,type 
  LoginRequest,type 
  LoginResponse,type 
  RequestPhoneOtpRequest,type 
  ResetPasswordRequest,type 
  SessionUser,type 
  SignupRequest,type 
  TwoFaCodeRequest,type 
  TwoFaDisableRequest,type 
  TwoFaEnableResponse,type 
  TwoFaRecoveryRequest,type 
  TwoFaSetupResponse,type 
  VerifyPhoneOtpRequest,
} from '@repo/api-client';

import type { UseMutationResult } from '@tanstack/react-query';

/**
 * The §5.1 mutations, as feature hooks (§6.4).
 *
 * Every one of them goes through `useApiMutation` from `@repo/api-client`, calling a typed
 * function from the package's `endpoints/` layer — so the path, the request shape and the
 * response shape all come from the B-4 contract and none of them is restated here. The envelope
 * is unwrapped, the failure is already an `ApiError`, and the CSRF and request-id headers are
 * added by the package's request interceptor. There is no axios instance, no path table and no
 * `fetch` in this feature.
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
export function useLogin(): Mutation<LoginResponse, LoginRequest> {
  return useApiMutation<LoginResponse, LoginRequest>({
    request: (body) => authApi.login(body),
    onMutate: primeCsrf,
    // A new session means a new identity; nothing cached under the old one still applies.
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/signup` — always a Consumer account (S-4). Answers the user directly. */
export function useSignup(): Mutation<SessionUser, SignupRequest> {
  return useApiMutation<SessionUser, SignupRequest>({
    request: (body) => authApi.signup(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/2fa/challenge` — completes a `twofaPending` session with a TOTP code (S-8). */
export function useTwoFactorChallenge(): Mutation<LoginResponse, TwoFaCodeRequest> {
  return useApiMutation<LoginResponse, TwoFaCodeRequest>({
    request: (body) => authApi.challengeTwoFactor(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/2fa/recovery` — the same completion with a single-use code (S-8). */
export function useTwoFactorRecovery(): Mutation<LoginResponse, TwoFaRecoveryRequest> {
  return useApiMutation<LoginResponse, TwoFaRecoveryRequest>({
    request: (body) => authApi.recoverTwoFactor(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}

/** `POST /auth/logout` — revokes this session and clears both cookies. */
export function useLogout(): Mutation<AuthAcknowledgement, void> {
  return useApiMutation<AuthAcknowledgement, void>({
    request: () => authApi.logout(),
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
export function useForgotPassword(): Mutation<AuthAcknowledgement, ForgotPasswordRequest> {
  return useApiMutation<AuthAcknowledgement, ForgotPasswordRequest>({
    request: (body) => authApi.forgotPassword(body),
    onMutate: primeCsrf,
  });
}

/** `POST /auth/password/reset` — single-use 30-minute token; revokes every session (S-6). */
export function useResetPassword(): Mutation<AuthAcknowledgement, ResetPasswordRequest> {
  return useApiMutation<AuthAcknowledgement, ResetPasswordRequest>({
    request: (body) => authApi.resetPassword(body),
    onMutate: primeCsrf,
  });
}

/** `POST /auth/password/change` — C-7. Keeps this session, revokes the others. */
export function useChangePassword(): Mutation<AuthAcknowledgement, ChangePasswordRequest> {
  return useApiMutation<AuthAcknowledgement, ChangePasswordRequest>({
    request: (body) => authApi.changePassword(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.sessions()],
  });
}

/** `POST /auth/email/verify/request` — re-sends the link (C-3). */
export function useRequestEmailVerification(): Mutation<AuthAcknowledgement, void> {
  return useApiMutation<AuthAcknowledgement, void>({
    request: () => authApi.requestEmailVerification(),
    onMutate: primeCsrf,
  });
}

/** `POST /auth/email/verify/confirm` — consumes the emailed token (C-3). */
export function useConfirmEmail(): Mutation<AuthAcknowledgement, ConfirmEmailVerificationRequest> {
  return useApiMutation<AuthAcknowledgement, ConfirmEmailVerificationRequest>({
    request: (body) => authApi.confirmEmailVerification(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.me(), queryKeys.me.account()],
  });
}

/** `POST /auth/phone/otp/request` — C-3, required before an enquiry. */
export function useRequestPhoneOtp(): Mutation<AuthAcknowledgement, RequestPhoneOtpRequest> {
  return useApiMutation<AuthAcknowledgement, RequestPhoneOtpRequest>({
    request: (body) => authApi.requestPhoneOtp(body),
    onMutate: primeCsrf,
  });
}

/** `POST /auth/phone/otp/verify` — stamps `phoneVerifiedAt` (C-3). */
export function useVerifyPhoneOtp(): Mutation<AuthAcknowledgement, VerifyPhoneOtpRequest> {
  return useApiMutation<AuthAcknowledgement, VerifyPhoneOtpRequest>({
    request: (body) => authApi.verifyPhoneOtp(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.me(), queryKeys.me.account()],
  });
}

/** `POST /auth/2fa/setup` — returns the secret and the provisioning URI, before confirmation. */
export function useTwoFactorSetup(): Mutation<TwoFaSetupResponse, void> {
  return useApiMutation<TwoFaSetupResponse, void>({
    request: () => authApi.setupTwoFactor(),
    onMutate: primeCsrf,
  });
}

/** `POST /auth/2fa/enable` — confirms a code and returns the recovery codes exactly once. */
export function useTwoFactorEnable(): Mutation<TwoFaEnableResponse, TwoFaCodeRequest> {
  return useApiMutation<TwoFaEnableResponse, TwoFaCodeRequest>({
    request: (body) => authApi.enableTwoFactor(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.me(), queryKeys.me.account()],
  });
}

/** `POST /auth/2fa/disable` — refused for admins with `TWOFA_REQUIRED_FOR_ROLE` (S-8). */
export function useTwoFactorDisable(): Mutation<AuthAcknowledgement, TwoFaDisableRequest> {
  return useApiMutation<AuthAcknowledgement, TwoFaDisableRequest>({
    request: (body) => authApi.disableTwoFactor(body),
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
export function useAcceptInvite(token: string): Mutation<SessionUser, AcceptInviteRequest> {
  return useApiMutation<SessionUser, AcceptInviteRequest>({
    request: (body) => authApi.acceptInvite(token, body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.all],
  });
}
