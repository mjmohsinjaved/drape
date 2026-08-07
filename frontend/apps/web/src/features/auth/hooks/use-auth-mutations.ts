'use client';

import {
  authApi,
  ensureCsrf,
  queryKeys,
  useApiMutation,
  type AcceptInviteRequest,
  type ApiError,
  type AuthAcknowledgement,
  type ChangePasswordRequest,
  type ConfirmEmailVerificationRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type LoginResponse,
  type RequestPhoneOtpRequest,
  type ResetPasswordRequest,
  type SessionUser,
  type SignupRequest,
  type VerifyPhoneOtpRequest,
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
 * first mutation. **Login and signup depend on it**: the API enforces CSRF on those two routes
 * like every other mutation — a cross-site form that could reach them would let an attacker sign
 * a visitor into an account he controls — so the anonymous-scope token from `GET /auth/csrf` is
 * what makes them work at all, not merely a head start on the cookie later mutations need.
 */
async function primeCsrf(): Promise<void> {
  await ensureCsrf();
}

type Mutation<TData, TVariables> = UseMutationResult<TData, ApiError, TVariables>;

/** `POST /auth/login` — S-1, S-6. Answers `{ user }`. */
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
