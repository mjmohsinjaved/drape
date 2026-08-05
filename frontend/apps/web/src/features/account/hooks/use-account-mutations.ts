'use client';

import {
  accountApi,
  authApi,
  ensureCsrf,
  queryKeys,
  useApiMutation,
  type ApiError,
type 
  AuthAcknowledgement,type 
  ConsumerProfile,type 
  MyAccount,type 
  NotificationPreferences,type 
  UpdateConsumerProfileRequest,type 
  UpdateMyAccountRequest,type 
  UpdateNotificationPreferencesRequest} from '@repo/api-client';

import type { UseMutationResult } from '@tanstack/react-query';

/**
 * The C-7 account mutations, and the two session controls that live beside them.
 *
 * Every call goes through a typed function in `@repo/api-client`'s `endpoints/` layer (§6.4), so
 * this feature holds no path table and restates no wire shape. `onMutate` primes the
 * double-submit CSRF cookie before the first mutation on the page (B-8).
 */
async function primeCsrf(): Promise<void> {
  await ensureCsrf();
}

type Mutation<TData, TVariables> = UseMutationResult<TData, ApiError, TVariables>;

/** `PATCH /me` — name, phone, locale (C-7). */
export function useUpdateMyAccount(): Mutation<MyAccount, UpdateMyAccountRequest> {
  return useApiMutation<MyAccount, UpdateMyAccountRequest>({
    request: (body) => accountApi.updateMyAccount(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.me.account(), queryKeys.auth.me()],
  });
}

/** `PATCH /me/profile` — the C-2 event details, asked here rather than at signup. */
export function useUpdateMyProfile(): Mutation<ConsumerProfile, UpdateConsumerProfileRequest> {
  return useApiMutation<ConsumerProfile, UpdateConsumerProfileRequest>({
    request: (body) => accountApi.updateMyProfile(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.me.profile()],
  });
}

/** `PATCH /me/notification-preferences` — C-7. Only the keys sent are written. */
export function useUpdateNotificationPreferences(): Mutation<
  NotificationPreferences,
  UpdateNotificationPreferencesRequest
> {
  return useApiMutation<NotificationPreferences, UpdateNotificationPreferencesRequest>({
    request: (body) => accountApi.updateNotificationPreferences(body),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.me.notificationPreferences()],
  });
}

/** `DELETE /auth/sessions/:sessionId` — revokes one of her own devices. */
export function useRevokeSession(): Mutation<AuthAcknowledgement, { sessionId: string }> {
  return useApiMutation<AuthAcknowledgement, { sessionId: string }>({
    request: ({ sessionId }) => authApi.revokeSession(sessionId),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.sessions()],
  });
}

/** `DELETE /auth/sessions` — everything except this device. */
export function useRevokeOtherSessions(): Mutation<AuthAcknowledgement, void> {
  return useApiMutation<AuthAcknowledgement, void>({
    request: () => authApi.revokeOtherSessions(),
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.sessions()],
  });
}
