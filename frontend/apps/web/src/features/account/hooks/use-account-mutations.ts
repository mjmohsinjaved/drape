'use client';

import { ensureCsrf, queryKeys, useApiMutation, type ApiError } from '@repo/api-client';

import { accountApi } from '@/features/account/api/paths';
import { authApi } from '@/features/auth/api/paths';

import type {
  ConsumerProfile,
  MyAccount,
  NotificationPreferences,
  UpdateConsumerProfileBody,
  UpdateMyAccountBody,
  UpdateNotificationPreferencesBody,
} from '@/features/account/api/types';
import type { AuthAcknowledgement } from '@/features/auth/api/types';
import type { UseMutationResult } from '@tanstack/react-query';

/**
 * The C-7 account mutations, and the two session controls that live beside them.
 *
 * Every call goes through `@repo/api-client`. `onMutate` primes the double-submit CSRF cookie
 * before the first mutation on the page (B-8).
 */
async function primeCsrf(): Promise<void> {
  await ensureCsrf();
}

type Mutation<TData, TVariables> = UseMutationResult<TData, ApiError, TVariables>;

/** `PATCH /me` — name, phone, locale (C-7). */
export function useUpdateMyAccount(): Mutation<MyAccount, UpdateMyAccountBody> {
  return useApiMutation<MyAccount, UpdateMyAccountBody>({
    url: accountApi.me,
    method: 'patch',
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.me.account(), queryKeys.auth.me()],
  });
}

/** `PATCH /me/profile` — the C-2 event details, asked here rather than at signup. */
export function useUpdateMyProfile(): Mutation<ConsumerProfile, UpdateConsumerProfileBody> {
  return useApiMutation<ConsumerProfile, UpdateConsumerProfileBody>({
    url: accountApi.profile,
    method: 'patch',
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.me.profile()],
  });
}

/** `PATCH /me/notification-preferences` — C-7. Only the keys sent are written. */
export function useUpdateNotificationPreferences(): Mutation<
  NotificationPreferences,
  UpdateNotificationPreferencesBody
> {
  return useApiMutation<NotificationPreferences, UpdateNotificationPreferencesBody>({
    url: accountApi.notificationPreferences,
    method: 'patch',
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.me.notificationPreferences()],
  });
}

/** `DELETE /auth/sessions/:sessionId` — revokes one of her own devices. */
export function useRevokeSession(): Mutation<AuthAcknowledgement, { sessionId: string }> {
  return useApiMutation<AuthAcknowledgement, { sessionId: string }>({
    url: (variables) => authApi.session(variables.sessionId),
    method: 'delete',
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.sessions()],
  });
}

/** `DELETE /auth/sessions` — everything except this device. */
export function useRevokeOtherSessions(): Mutation<AuthAcknowledgement, void> {
  return useApiMutation<AuthAcknowledgement, void>({
    url: authApi.sessions,
    method: 'delete',
    onMutate: primeCsrf,
    invalidateKeys: [queryKeys.auth.sessions()],
  });
}
