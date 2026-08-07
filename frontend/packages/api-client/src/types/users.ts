/**
 * ARCHITECTURE.md §5.2 `users` — admins, consumers, self.
 *
 * Written against `modules/users/dto/**`, plus the two controllers that also mount on `/me`:
 * `modules/retention` (`/me/data`, `/me/export`, `DELETE /me`) and `modules/notifications`
 * (`/me/notifications`). Where §5.2 and the DTOs disagree, the DTOs win (B-4).
 *
 * **S-10 is load-bearing here.** No admin-facing shape in this file carries a person photo, a
 * `person-photos/**` storage key, or a signed URL for one. The only renders an admin may see come
 * through `enquiry_items` (§4.24) and are typed on {@link AdminConsumerRender}.
 */

import type {
  IsoDate,
  IsoDateTime,
  PaginationQuery,
  SearchablePaginationQuery,
  Uuid,
} from './common';
import type {
  BudgetBand,
  DeletionInitiator,
  DeletionSubject,
  EnquiryStatus,
  EventType,
  Locale,
  NotificationChannel,
  Role,
  UserStatus,
  Verdict,
} from './enums';

/** §4.4 `consumer_profiles.notificationPreferences`, C-7. */
export interface NotificationPreferences {
  emailOnResultReady: boolean;
  emailOnEnquiryUpdate: boolean;
  emailOnNewArrivals: boolean;
  smsOnEnquiryUpdate: boolean;
}

/* ---------------------------------------------------------------- self (`/me`) */

/**
 * `MeResponseDto` — `GET /me` and `PATCH /me` (ANY).
 *
 * The DTO sends two **booleans** — `emailVerified` and `phoneVerified` — not the nullable
 * timestamps `GET /auth/me` uses for them. The two routes answer different shapes on
 * purpose: `/auth/me` is the role-resolution probe, this is the account screen.
 */
export interface MyAccount {
  id: Uuid;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  locale: Locale;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: IsoDateTime;
  lastLoginAt: IsoDateTime | null;
  /** Set once she has asked for deletion; the purge completes within `DELETION_SLA_HOURS` (C-38). */
  deletionRequestedAt: IsoDateTime | null;
}

/**
 * `PATCH /me` (ANY) — name, phone, locale (C-7). Email, role and status are not writable here.
 *
 * Changing the phone clears its verification server-side, so C-3 asks for it again before the
 * next enquiry. The form says so before the change is saved.
 */
export interface UpdateMyAccountRequest {
  name?: string;
  /** E.164, e.g. `+923001234567`. */
  phone?: string;
  locale?: Locale;
}

/**
 * `ConsumerProfileResponseDto` — `GET /me/profile` (CONSUMER), §4.4, C-2.
 *
 * There is no `userId`: the row is the caller's, and an id here would only invite a client to
 * think it could ask for someone else's.
 */
export interface ConsumerProfile {
  eventDate: IsoDate | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  preferredCategories: Uuid[];
  /** Read-only here. Null means the global default applies; only an admin can set it (A-18). */
  monthlyQuotaOverride: number | null;
  onboardingCompletedAt: IsoDateTime | null;
}

/**
 * `PATCH /me/profile` (CONSUMER).
 *
 * Omitting a key leaves it alone; sending `null` clears one she would rather not share. There is
 * no `onboardingCompleted` flag — `onboardingCompletedAt` is stamped server-side. An empty
 * `preferredCategories` array clears the list; the API caps it at 12.
 */
export interface UpdateConsumerProfileRequest {
  eventDate?: IsoDate | null;
  eventType?: EventType | null;
  budgetBand?: BudgetBand | null;
  preferredCategories?: Uuid[];
}

/** `GET` / `PATCH /me/notification-preferences` (ANY). The PATCH body is a partial. */
export type UpdateNotificationPreferencesRequest = Partial<NotificationPreferences>;

/* ----------------------------------------------- her data (`retention`, C-37 … C-39) */

/**
 * One section of {@link MyDataSummary}. Each list is capped at one screen and reports its true
 * total beside the count shown; `POST /me/export` is where she gets all of it.
 */
export interface MyDataSection<TItem> {
  total: number;
  shown: number;
  items: TItem[];
}

export interface MyDataProfile {
  id: Uuid;
  name: string;
  email: string;
  phone: string | null;
  locale: Locale;
  createdAt: IsoDateTime;
  emailVerifiedAt: IsoDateTime | null;
  phoneVerifiedAt: IsoDateTime | null;
  lastActiveAt: IsoDateTime | null;
  deletionRequestedAt: IsoDateTime | null;
}

export interface MyDataPhoto {
  id: Uuid;
  label: string | null;
  /** The one her try-ons run against (C-16). */
  isActive: boolean;
  uploadedAt: IsoDateTime;
  /** §9.3 — when it is deleted if she does not return before then. */
  purgeAfter: IsoDateTime;
  /** Signed and scoped to her own id (§3.4). Hers to see. */
  url: string;
}

export interface MyDataRender {
  id: Uuid;
  /** Snapshot — survives the garment being removed (C-29). */
  garmentTitle: string;
  garmentCategory: string;
  createdAt: IsoDateTime;
  /** §9.3 — per-render marketing opt-in. Null means she has not granted one. */
  marketingOptInAt: IsoDateTime | null;
  url: string;
}

export interface MyDataShortlistItem {
  id: Uuid;
  verdict: Verdict;
  rejectReason: string | null;
  note: string | null;
  verdictAt: IsoDateTime;
}

export interface MyDataEnquiry {
  reference: string;
  status: EnquiryStatus;
  itemCount: number;
  createdAt: IsoDateTime;
}

export interface MyDataShareLink {
  id: Uuid;
  label: string | null;
  expiresAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
  viewCount: number;
}

export interface MyDataConsent {
  policyVersion: string;
  grantedAt: IsoDateTime;
  /** Which translation she read. */
  locale: Locale;
  /** False when the policy has moved on since — `CONSENT_STALE` (C-12). */
  current: boolean;
}

/**
 * `MyDataResponseDto` — `GET /me/data` (CONSUMER), C-37.
 *
 * A live read, never a cached snapshot: a stored copy of "everything about her" would be a second
 * place her data lives.
 */
export interface MyDataSummary {
  profile: MyDataProfile;
  photos: MyDataSection<MyDataPhoto>;
  renders: MyDataSection<MyDataRender>;
  shortlist: MyDataSection<MyDataShortlistItem>;
  enquiries: MyDataSection<MyDataEnquiry>;
  shareLinks: MyDataSection<MyDataShareLink>;
  consent: MyDataConsent | null;
  generatedAt: IsoDateTime;
}

/**
 * The archive lifecycle the API actually exposes. It is built **inline**, not queued, so there is
 * no `PENDING`, `RUNNING` or `FAILED` state for a client to poll through — the response to
 * `POST /me/export` is already `READY`.
 */
export const EXPORT_STATUSES = ['READY', 'EXPIRED'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/**
 * `DataExportResponseDto` — `POST /me/export` and `GET /me/export/:exportId` (CONSUMER), C-39.
 *
 * Both routes answer the same shape; there is no separate "start" response.
 */
export interface DataExport {
  exportId: Uuid;
  status: ExportStatus;
  /** Signed and scoped to her own id (§3.4). Null once the archive has expired. */
  downloadUrl: string | null;
  byteSize: number;
  renderCount: number;
  shortlistCount: number;
  /** True when a cap bit and the archive is partial; a `TRUNCATED.txt` inside says so too. */
  truncated: boolean;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

/**
 * `DeletionReceiptResponseDto` — the 202 body of `DELETE /me` (CONSUMER, C-38).
 *
 * **`DELETE /me` takes no request body.** There is no `confirmation` field, no password and no
 * reason on the wire: D-17's typed confirmation is a client-side gate on the button, and the API
 * authorises on the session alone.
 *
 * `completedAt` is null until the purge has actually run — reporting a completion that has not
 * happened is the one lie this module exists to avoid.
 */
export interface SelfDeletionReceipt {
  /** The `deletion_log` row (§4.31). */
  deletionLogId: Uuid;
  subjectType: DeletionSubject;
  subjectId: Uuid;
  initiatedBy: DeletionInitiator;
  requestedAt: IsoDateTime;
  /** `DELETION_SLA_HOURS` after the request — the C-38 / A-20 promise. */
  dueBy: IsoDateTime;
  completedAt: IsoDateTime | null;
}

/* ------------------------------------------------------- in-app notifications */

/**
 * One row of `GET /me/notifications` (ANY) — §4.32 rows with `channel = IN_APP`.
 *
 * The row carries rendered `title` and `body`, not a template payload for the client to
 * interpolate: the copy is written and translated server-side (§10.5).
 */
export interface InAppNotification {
  id: Uuid;
  /** Always `IN_APP` on this route — the other channels are not a store. */
  channel: NotificationChannel;
  /** The `@library/notifications` template id this row was written against. */
  template: string;
  locale: Locale;
  title: string;
  body: string;
  /** Where the notification points, when its template carries an action link. */
  actionUrl: string | null;
  /** Null until she opens it (A-25). */
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export const NOTIFICATION_SORT_KEYS = ['createdAt', 'readAt'] as const;
export type NotificationSortKey = (typeof NOTIFICATION_SORT_KEYS)[number];

export interface NotificationListQuery extends PaginationQuery {
  unreadOnly?: boolean;
  sortBy?: NotificationSortKey;
}

/**
 * `GET /me/notifications/count` and `POST /me/notifications/read-all` (ANY).
 *
 * The counts are absolute, not a delta: `unread` after the call, and `total` held.
 */
export interface NotificationCounts {
  unread: number;
  total: number;
}

/* ----------------------------------------------------------- admin: admin users */

/**
 * `AdminUserResponseDto` — `GET /admin/users`, `GET /admin/users/:userId` and the three
 * role/status mutations (ADMIN), A-2.
 *
 * `invitedBy` is the inviting admin's **id**, not a name, and is null for the deployment seed
 * account (S-5).
 */
export interface AdminUser {
  id: Uuid;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  locale: Locale;
  emailVerified: boolean;
  lastLoginAt: IsoDateTime | null;
  lastActiveAt: IsoDateTime | null;
  /** Set when the account was deactivated or suspended. */
  suspendedAt: IsoDateTime | null;
  invitedBy: Uuid | null;
  createdAt: IsoDateTime;
}

export const ADMIN_USER_SORTABLE_COLUMNS = [
  'createdAt',
  'lastActiveAt',
  'lastLoginAt',
  'name',
  'email',
  'status',
] as const;
export type AdminUserSortColumn = (typeof ADMIN_USER_SORTABLE_COLUMNS)[number];

export interface AdminUserListQuery extends SearchablePaginationQuery {
  status?: UserStatus;
  sortBy?: AdminUserSortColumn;
}

/**
 * `PATCH /admin/users/:userId/role` (ADMIN). Rejects a self-change
 * (`SELF_ROLE_CHANGE_FORBIDDEN`) and the last active admin (`LAST_ADMIN_PROTECTED`). Promotion to
 * ADMIN is rejected outright — admins arrive by invitation or by the deployment seed (S-5).
 */
export interface ChangeUserRoleRequest {
  role: Role;
}

/* ------------------------------------------------------------ admin: consumers */

/** One row of `GET /admin/consumers` (ADMIN) — A-16. Never carries a photo (S-10). */
export interface AdminConsumerListItem {
  id: Uuid;
  name: string;
  email: string;
  phone: string | null;
  signedUpAt: IsoDateTime;
  lastActiveAt: IsoDateTime | null;
  /** Consumed in the current `Asia/Karachi` period, derived from `quota_ledger` (§4.26). */
  generationsThisMonth: number;
  /** Loves and maybes. Rejections are excluded (§4.20). */
  shortlistSize: number;
  enquiryCount: number;
  status: UserStatus;
}

export const CONSUMER_SORTABLE_COLUMNS = [
  'createdAt',
  'lastActiveAt',
  'name',
  'email',
  'status',
] as const;
export type ConsumerSortColumn = (typeof CONSUMER_SORTABLE_COLUMNS)[number];

export interface AdminConsumerListQuery extends SearchablePaginationQuery {
  status?: UserStatus;
  /** Only accounts that have submitted at least one enquiry. Note the plural. */
  hasEnquiries?: boolean;
  sortBy?: ConsumerSortColumn;
}

/** The profile block embedded in {@link AdminConsumerDetail}. Always present, never null. */
export interface AdminConsumerProfileSummary {
  eventDate: IsoDate | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  preferredCategories: Uuid[];
  /** A-18. Null means the global `quota.defaultMonthly` applies. */
  monthlyQuotaOverride: number | null;
  onboardingCompletedAt: IsoDateTime | null;
}

/** One of her enquiries, as the consumer detail screen lists them (A-17). */
export interface AdminConsumerEnquirySummary {
  id: Uuid;
  reference: string;
  status: EnquiryStatus;
  createdAt: IsoDateTime;
  firstRespondedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
  totalValueSnapshot: number | null;
}

/**
 * `ConsumerDetailResponseDto` — `GET /admin/consumers/:userId` and the quota, suspend, unsuspend
 * mutations (ADMIN), A-17. **Never includes her photo** (S-10), and carries no photo count.
 */
export interface AdminConsumerDetail {
  id: Uuid;
  name: string;
  email: string;
  phone: string | null;
  status: UserStatus;
  /** A-19 requires a reason on suspension. */
  suspendedReason: string | null;
  suspendedAt: IsoDateTime | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  locale: Locale;
  signedUpAt: IsoDateTime;
  lastActiveAt: IsoDateTime | null;
  lastLoginAt: IsoDateTime | null;
  deletionRequestedAt: IsoDateTime | null;
  profile: AdminConsumerProfileSummary;
  generationsThisMonth: number;
  shortlistSize: number;
  enquiryCount: number;
  enquiries: AdminConsumerEnquirySummary[];
}

/**
 * One row of `GET /admin/consumers/:userId/renders` (ADMIN).
 *
 * §4.24: `enquiry_items` is the **sole basis** on which an admin may view a render. Every row here
 * is reachable from one of her enquiries; there is no other path from an admin route to a
 * `renders/**` signed URL (A-17, S-10).
 */
export interface AdminConsumerRender {
  id: Uuid;
  createdAt: IsoDateTime;
  /** Signed, expiring, and scoped to the requesting admin. */
  url: string;
  thumbnailUrl: string | null;
  /** Snapshot taken when the render was produced (C-29). */
  garmentTitle: string;
  garmentCategory: string;
  garmentPrice: number | null;
  garmentCurrency: string;
  width: number;
  height: number;
  /** The enquiry that makes this render visible at all. */
  enquiryId: Uuid;
  enquiryReference: string;
}

export const ADMIN_RENDER_SORTABLE_COLUMNS = ['createdAt'] as const;
export type AdminRenderSortColumn = (typeof ADMIN_RENDER_SORTABLE_COLUMNS)[number];

export interface AdminConsumerRenderQuery extends PaginationQuery {
  sortBy?: AdminRenderSortColumn;
}

/** One row of `GET /admin/consumers/:userId/shortlist` (ADMIN) — A-17. */
export interface AdminConsumerShortlistItem {
  id: Uuid;
  garmentId: Uuid;
  garmentTitle: string;
  garmentSku: string;
  garmentPrice: number | null;
  garmentCurrency: string;
  /** Only loves and maybes reach this route; rejections are not a shortlist (§4.20). */
  verdict: Extract<Verdict, 'LOVE_IT' | 'MAYBE'>;
  /** Her drag-to-rank order. */
  rank: number | null;
  note: string | null;
  verdictAt: IsoDateTime;
}

export const ADMIN_SHORTLIST_SORTABLE_COLUMNS = ['rank', 'verdictAt', 'createdAt'] as const;
export type AdminShortlistSortColumn = (typeof ADMIN_SHORTLIST_SORTABLE_COLUMNS)[number];

export interface AdminConsumerShortlistQuery extends PaginationQuery {
  sortBy?: AdminShortlistSortColumn;
}

/**
 * `PATCH /admin/consumers/:userId/quota` (ADMIN) — A-18. `null` restores the global default.
 *
 * There is no `note` field: the reason for the change lives in the audit log the route writes,
 * not in the payload.
 */
export interface SetConsumerQuotaOverrideRequest {
  /** 0 … 1000, or `null`. */
  monthlyQuotaOverride: number | null;
}

/** `POST /admin/consumers/:userId/suspend` (ADMIN) — A-19. 10 … 1000 characters, and required. */
export interface SuspendConsumerRequest {
  /** Why the account is on hold. **Shown to the consumer** (A-19, D-7). */
  reason: string;
}

/**
 * `DELETE /admin/consumers/:userId` (ADMIN) — A-20. D-17 requires typing her name.
 *
 * The field is `confirmName`, and it is compared to her name case- and space-insensitively.
 * There is no `reason` on this payload.
 */
export interface DeleteConsumerRequest {
  confirmName: string;
}

/**
 * The 202 body of `DELETE /admin/consumers/:userId`.
 *
 * Distinct from {@link SelfDeletionReceipt}: the admin receipt reports how many of her live
 * sessions were revoked, and has no `completedAt` — the purge has not run yet by definition.
 */
export interface AdminDeletionReceipt {
  deletionLogId: Uuid;
  subjectType: DeletionSubject;
  subjectId: Uuid;
  initiatedBy: DeletionInitiator;
  requestedAt: IsoDateTime;
  dueBy: IsoDateTime;
  /** Live sessions revoked as part of the request. */
  sessionsRevoked: number;
}
