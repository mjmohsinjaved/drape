/**
 * The `/me` half of ARCHITECTURE.md §5.2 — the caller's own account (C-2, C-7), plus the
 * `/me/data`, `/me/export` and `DELETE /me` routes `retention` mounts on the same prefix
 * (C-37 … C-39) and the `/me/notifications` routes `notifications` mounts there (A-25).
 *
 * **No route here takes a user id.** Ownership comes from the session, so there is no id for a
 * caller to substitute and no ownership to infer from an unguessable value (§9.2).
 */

import { del, get, getList, patch, post, segment, type EndpointOptions } from './http';

import type { Paginated } from '../types/envelope';
import type {
  ConsumerProfile,
  DataExport,
  InAppNotification,
  MyAccount,
  MyDataSummary,
  NotificationCounts,
  NotificationListQuery,
  NotificationPreferences,
  SelfDeletionReceipt,
  UpdateConsumerProfileRequest,
  UpdateMyAccountRequest,
  UpdateNotificationPreferencesRequest,
} from '../types/users';

export const accountPaths = {
  /** `GET` / `PATCH /me` (ANY) — name, phone, locale. */
  me: '/me',
  /** `GET` / `PATCH /me/profile` (CONSUMER) — the C-2 event details, prompted in context. */
  profile: '/me/profile',
  /** `GET` / `PATCH /me/notification-preferences` (ANY) — C-7. */
  notificationPreferences: '/me/notification-preferences',

  /** `GET /me/data` (CONSUMER) — everything stored about her, live-read (C-37). */
  data: '/me/data',
  /** `POST /me/export` (CONSUMER) — builds the archive inline and answers it ready (C-39). */
  exports: '/me/export',
  export: (exportId: string): string => `/me/export/${segment(exportId)}`,

  notifications: '/me/notifications',
  notificationCount: '/me/notifications/count',
  notificationRead: (notificationId: string): string =>
    `/me/notifications/${segment(notificationId)}/read`,
  notificationsReadAll: '/me/notifications/read-all',
} as const;

/* ------------------------------------------------------------------ account (C-7) */

/** `GET /me` (ANY). */
export async function getMyAccount(options?: EndpointOptions): Promise<MyAccount> {
  return get<MyAccount>(accountPaths.me, options);
}

/** `PATCH /me` (ANY). Changing the phone clears its verification, so C-3 asks again. */
export async function updateMyAccount(
  body: UpdateMyAccountRequest,
  options?: EndpointOptions,
): Promise<MyAccount> {
  return patch<MyAccount, UpdateMyAccountRequest>(accountPaths.me, body, options);
}

/** `GET /me/profile` (CONSUMER) — C-2. */
export async function getMyProfile(options?: EndpointOptions): Promise<ConsumerProfile> {
  return get<ConsumerProfile>(accountPaths.profile, options);
}

/** `PATCH /me/profile` (CONSUMER). Omitting a key leaves it alone; `null` clears it. */
export async function updateMyProfile(
  body: UpdateConsumerProfileRequest,
  options?: EndpointOptions,
): Promise<ConsumerProfile> {
  return patch<ConsumerProfile, UpdateConsumerProfileRequest>(
    accountPaths.profile,
    body,
    options,
  );
}

/** `GET /me/notification-preferences` (ANY) — C-7. */
export async function getNotificationPreferences(
  options?: EndpointOptions,
): Promise<NotificationPreferences> {
  return get<NotificationPreferences>(accountPaths.notificationPreferences, options);
}

/** `PATCH /me/notification-preferences` (ANY). Only the keys sent are written. */
export async function updateNotificationPreferences(
  body: UpdateNotificationPreferencesRequest,
  options?: EndpointOptions,
): Promise<NotificationPreferences> {
  return patch<NotificationPreferences, UpdateNotificationPreferencesRequest>(
    accountPaths.notificationPreferences,
    body,
    options,
  );
}

/* ------------------------------------------------------------------ her data (C-37 … C-39) */

/** `GET /me/data` (CONSUMER) — C-37. Each section reports its true total beside what it shows. */
export async function getMyData(options?: EndpointOptions): Promise<MyDataSummary> {
  return get<MyDataSummary>(accountPaths.data, options);
}

/**
 * `POST /me/export` (CONSUMER) — C-39.
 *
 * The archive is built inline rather than queued, so the response is already `READY` with a
 * signed `downloadUrl`. There is no job to poll.
 */
export async function createDataExport(options?: EndpointOptions): Promise<DataExport> {
  return post<DataExport>(accountPaths.exports, undefined, options);
}

/** `GET /me/export/:exportId` (CONSUMER) — re-reads the archive, or reports it expired. */
export async function getDataExport(
  exportId: string,
  options?: EndpointOptions,
): Promise<DataExport> {
  return get<DataExport>(accountPaths.export(exportId), options);
}

/**
 * `DELETE /me` (CONSUMER) — C-38. Answers 202 with the `deletion_log` receipt.
 *
 * **The API takes no body.** D-17's typed confirmation is a gate on the button, not a field on
 * the wire, so nothing is passed here.
 */
export async function requestAccountDeletion(
  options?: EndpointOptions,
): Promise<SelfDeletionReceipt> {
  return del<SelfDeletionReceipt>(accountPaths.me, options);
}

/* ------------------------------------------------------------------ notifications (A-25) */

/** `GET /me/notifications` (ANY) — §4.32 rows with `channel = IN_APP`. Paginated (§2.8). */
export async function listNotifications(
  query: NotificationListQuery = {},
  options?: EndpointOptions,
): Promise<Paginated<InAppNotification>> {
  return getList<InAppNotification>(accountPaths.notifications, options, query);
}

/** `GET /me/notifications/count` (ANY) — the unread badge. */
export async function getNotificationCounts(
  options?: EndpointOptions,
): Promise<NotificationCounts> {
  return get<NotificationCounts>(accountPaths.notificationCount, options);
}

/** `POST /me/notifications/:notificationId/read` (ANY) — stamps `readAt`. */
export async function markNotificationRead(
  notificationId: string,
  options?: EndpointOptions,
): Promise<InAppNotification> {
  return post<InAppNotification>(
    accountPaths.notificationRead(notificationId),
    undefined,
    options,
  );
}

/** `POST /me/notifications/read-all` (ANY). Answers the counts after the sweep, not a delta. */
export async function markAllNotificationsRead(
  options?: EndpointOptions,
): Promise<NotificationCounts> {
  return post<NotificationCounts>(accountPaths.notificationsReadAll, undefined, options);
}
