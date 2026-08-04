/**
 * ARCHITECTURE.md §5.2 `users` — admins, consumers, self.
 *
 * **S-10 is load-bearing here.** No admin-facing shape in this file carries a person photo, a
 * `person-photos/**` storage key, or a signed URL for one. The only renders an admin may see come
 * through `enquiry_items` (§4.24) and are typed on {@link AdminConsumerRender}.
 */

import {
  type IsoDate,
  type IsoDateTime,
  type LedgerPeriod,
  type PaginationQuery,
  type SearchablePaginationQuery,
  type SignedFileUrl,
  type Uuid,
} from './common';
import {
  type BudgetBand,
  type EventType,
  type Locale,
  type Role,
  type UserStatus,
} from './enums';

/** §4.4 `consumer_profiles.notificationPreferences`, C-7. */
export interface NotificationPreferences {
  emailOnResultReady: boolean;
  emailOnEnquiryUpdate: boolean;
  emailOnNewArrivals: boolean;
  smsOnEnquiryUpdate: boolean;
}

/* ---------------------------------------------------------------- self (`/me`) */

/** `GET /me` (ANY) — the caller's own profile. */
export interface MyAccount {
  id: Uuid;
  role: Role;
  email: string;
  name: string;
  phone: string | null;
  locale: Locale;
  status: UserStatus;
  emailVerifiedAt: IsoDateTime | null;
  phoneVerifiedAt: IsoDateTime | null;
  twofaEnabledAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  /** Set once she has asked for deletion; the purge completes within `DELETION_SLA_HOURS` (C-38). */
  deletionRequestedAt: IsoDateTime | null;
}

/** `PATCH /me` (ANY) — name, phone, locale (C-7). Changing the phone clears `phoneVerifiedAt`. */
export interface UpdateMyAccountRequest {
  name?: string;
  phone?: string | null;
  locale?: Locale;
}

/** `GET /me/profile` (CONSUMER) — §4.4, C-2. */
export interface ConsumerProfile {
  userId: Uuid;
  eventDate: IsoDate | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  preferredCategories: Uuid[];
  onboardingCompletedAt: IsoDateTime | null;
}

/** `PATCH /me/profile` (CONSUMER). */
export interface UpdateConsumerProfileRequest {
  eventDate?: IsoDate | null;
  eventType?: EventType | null;
  budgetBand?: BudgetBand | null;
  preferredCategories?: Uuid[];
  onboardingCompleted?: boolean;
}

/** `GET` / `PATCH /me/notification-preferences` (ANY). The PATCH body is a partial. */
export type UpdateNotificationPreferencesRequest = Partial<NotificationPreferences>;

/**
 * `GET /me/data` (CONSUMER) — everything stored about her, rendered on the "your data" screen
 * (C-37). Counts and summaries; the downloadable archive is `POST /me/export`.
 */
export interface MyDataSummary {
  account: MyAccount;
  profile: ConsumerProfile | null;
  consent: {
    grantedAt: IsoDateTime | null;
    policyVersion: string | null;
  };
  counts: {
    personPhotos: number;
    results: number;
    shortlistItems: number;
    enquiries: number;
    shareLinks: number;
  };
  retention: {
    /** Photos are purged `PHOTO_RETENTION_DAYS` after her last activity (§9.3). */
    photosPurgeAfter: IsoDateTime | null;
    /** Renders carry no expiry, deliberately (C-27, §9.3). */
    rendersRetainedIndefinitely: true;
  };
}

/** `POST /me/export` (CONSUMER) — starts a data-export archive (C-39). */
export interface StartExportResponse {
  exportId: Uuid;
  status: ExportStatus;
  requestedAt: IsoDateTime;
}

export const EXPORT_STATUSES = ['PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/**
 * `GET /me/export/:exportId` (CONSUMER). `download` is present only when `status === 'READY'`;
 * reading it earlier is `EXPORT_NOT_READY`.
 */
export interface ExportStatusResponse {
  exportId: Uuid;
  status: ExportStatus;
  requestedAt: IsoDateTime;
  readyAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
  byteSize: number | null;
  download: SignedFileUrl | null;
}

/** `DELETE /me` (CONSUMER) — C-38. D-17 requires her to type the confirmation phrase. */
export interface DeleteMyAccountRequest {
  /** The typed confirmation, checked server-side against her own name. */
  confirmation: string;
  password: string;
  reason?: string;
}

export interface DeleteMyAccountResponse {
  deletionRequestedAt: IsoDateTime;
  /** `DELETION_SLA_HOURS` — immediate from her view, backend completes within this window. */
  completesWithinHours: number;
}

/* ------------------------------------------------------- in-app notifications */

/** One row of `GET /me/notifications` (ANY) — §4.32 rows with `channel = IN_APP`. */
export interface InAppNotification {
  id: Uuid;
  template: string;
  locale: Locale;
  /** Template variables only, never a photo key (§4.32). */
  payload: Record<string, unknown>;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface NotificationListQuery extends PaginationQuery {
  unreadOnly?: boolean;
}

export interface MarkNotificationsReadResponse {
  updatedCount: number;
  unreadCount: number;
}

/* ----------------------------------------------------------- admin: admin users */

/** One row of `GET /admin/users` (ADMIN) — admin accounts (A-2). */
export interface AdminUserListItem {
  id: Uuid;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  twofaEnabledAt: IsoDateTime | null;
  lastLoginAt: IsoDateTime | null;
  invitedByName: string | null;
  createdAt: IsoDateTime;
}

/** `GET /admin/users/:userId` (ADMIN). */
export interface AdminUserDetail extends AdminUserListItem {
  phone: string | null;
  emailVerifiedAt: IsoDateTime | null;
  lastActiveAt: IsoDateTime | null;
  suspendedReason: string | null;
  suspendedAt: IsoDateTime | null;
}

export interface AdminUserListQuery extends SearchablePaginationQuery {
  status?: UserStatus;
  sortBy?: 'createdAt' | 'lastLoginAt' | 'name' | 'email';
}

/**
 * `PATCH /admin/users/:userId/role` (ADMIN). Rejects a self-change
 * (`SELF_ROLE_CHANGE_FORBIDDEN`) and the last active admin (`LAST_ADMIN_PROTECTED`).
 */
export interface ChangeUserRoleRequest {
  role: Role;
}

/** `POST /admin/users/:userId/deactivate` (ADMIN). Revokes live sessions immediately (A-2). */
export interface DeactivateUserRequest {
  reason?: string;
}

/* ------------------------------------------------------------ admin: consumers */

/** One row of `GET /admin/consumers` (ADMIN) — A-16. Never carries a photo (S-10). */
export interface AdminConsumerListItem {
  id: Uuid;
  name: string;
  email: string;
  phone: string | null;
  status: UserStatus;
  signedUpAt: IsoDateTime;
  lastActiveAt: IsoDateTime | null;
  generationsThisMonth: number;
  shortlistSize: number;
  enquiryCount: number;
}

export interface AdminConsumerListQuery extends SearchablePaginationQuery {
  status?: UserStatus;
  hasEnquiry?: boolean;
  sortBy?: 'createdAt' | 'lastActiveAt' | 'generationsThisMonth' | 'shortlistSize' | 'name';
}

/** `GET /admin/consumers/:userId` (ADMIN) — A-17. **Never includes her photo** (S-10). */
export interface AdminConsumerDetail extends AdminConsumerListItem {
  locale: Locale;
  emailVerifiedAt: IsoDateTime | null;
  phoneVerifiedAt: IsoDateTime | null;
  suspendedReason: string | null;
  suspendedAt: IsoDateTime | null;
  deletionRequestedAt: IsoDateTime | null;
  profile: ConsumerProfile | null;
  quota: {
    period: LedgerPeriod;
    limit: number;
    used: number;
    remaining: number;
    /** §4.4 `monthlyQuotaOverride`; null means the global default applies (A-18). */
    monthlyQuotaOverride: number | null;
  };
  consent: {
    grantedAt: IsoDateTime | null;
    policyVersion: string | null;
  };
  /** How many photos she has, as a count only — no keys, no thumbnails, no URLs (S-10). */
  personPhotoCount: number;
}

/**
 * One row of `GET /admin/consumers/:userId/renders` (ADMIN).
 *
 * §4.24: `enquiry_items` is the **sole basis** on which an admin may view a render. Every item
 * here is reachable from one of her enquiries; there is no other path from an admin route to a
 * `renders/**` signed URL (A-17, S-10).
 */
export interface AdminConsumerRender {
  resultId: Uuid;
  enquiryId: Uuid;
  enquiryReference: string;
  garmentId: Uuid | null;
  garmentTitleSnapshot: string;
  rank: number;
  note: string | null;
  thumbnail: SignedFileUrl | null;
  image: SignedFileUrl | null;
  createdAt: IsoDateTime;
}

/** One row of `GET /admin/consumers/:userId/shortlist` (ADMIN) — A-17. */
export interface AdminConsumerShortlistItem {
  itemId: Uuid;
  garmentId: Uuid;
  garmentTitle: string;
  garmentSku: string;
  price: number | null;
  currency: string;
  rank: number | null;
  verdict: 'LOVE_IT' | 'MAYBE';
  note: string | null;
  verdictAt: IsoDateTime;
}

/** `PATCH /admin/consumers/:userId/quota` (ADMIN) — A-18. `null` clears the override. */
export interface SetConsumerQuotaOverrideRequest {
  monthlyQuotaOverride: number | null;
  note?: string;
}

/** `POST /admin/consumers/:userId/suspend` (ADMIN) — A-19. The reason is required. */
export interface SuspendConsumerRequest {
  reason: string;
}

/** `DELETE /admin/consumers/:userId` (ADMIN) — A-20. D-17 requires typing her name. */
export interface DeleteConsumerRequest {
  /** Must match her name exactly. */
  confirmation: string;
  reason?: string;
}

export interface DeleteConsumerResponse {
  deletionRequestedAt: IsoDateTime;
  completesWithinHours: number;
}
