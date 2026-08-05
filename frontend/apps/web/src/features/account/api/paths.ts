/**
 * The `/me` half of ARCHITECTURE §5.2 — the caller's own account (C-7, C-2).
 *
 * **No route here takes a user id.** Ownership comes from the session, so there is no id for a
 * caller to substitute and no ownership to infer from an unguessable value (§9.2).
 */
export const accountApi = {
  /** `GET` / `PATCH /me` (ANY) — name, phone, locale. */
  me: '/me',
  /** `GET` / `PATCH /me/profile` (CONSUMER) — the C-2 event details, prompted in context. */
  profile: '/me/profile',
  /** `GET` / `PATCH /me/notification-preferences` (ANY) — C-7. */
  notificationPreferences: '/me/notification-preferences',
} as const;
