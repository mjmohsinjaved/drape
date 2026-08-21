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

export interface NotificationPreferences {
  emailOnResultReady: boolean;
  emailOnEnquiryUpdate: boolean;
  emailOnNewArrivals: boolean;
  smsOnEnquiryUpdate: boolean;
}

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
  twofaEnabled: boolean;
  createdAt: IsoDateTime;
  lastLoginAt: IsoDateTime | null;
  deletionRequestedAt: IsoDateTime | null;
}

export interface UpdateMyAccountRequest {
  name?: string;
  phone?: string;
  locale?: Locale;
}

export interface ConsumerProfile {
  eventDate: IsoDate | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  preferredCategories: Uuid[];
  monthlyQuotaOverride: number | null;
  onboardingCompletedAt: IsoDateTime | null;
}

export interface UpdateConsumerProfileRequest {
  eventDate?: IsoDate | null;
  eventType?: EventType | null;
  budgetBand?: BudgetBand | null;
  preferredCategories?: Uuid[];
}

export type UpdateNotificationPreferencesRequest = Partial<NotificationPreferences>;

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
  isActive: boolean;
  uploadedAt: IsoDateTime;
  purgeAfter: IsoDateTime;
  url: string;
}

export interface MyDataRender {
  id: Uuid;
  garmentTitle: string;
  garmentCategory: string;
  createdAt: IsoDateTime;
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
  locale: Locale;
  current: boolean;
}

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

export const EXPORT_STATUSES = ['READY', 'EXPIRED'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export interface DataExport {
  exportId: Uuid;
  status: ExportStatus;
  downloadUrl: string | null;
  byteSize: number;
  renderCount: number;
  shortlistCount: number;
  truncated: boolean;
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

export interface SelfDeletionReceipt {
  deletionLogId: Uuid;
  subjectType: DeletionSubject;
  subjectId: Uuid;
  initiatedBy: DeletionInitiator;
  requestedAt: IsoDateTime;
  dueBy: IsoDateTime;
  completedAt: IsoDateTime | null;
}

export interface InAppNotification {
  id: Uuid;
  channel: NotificationChannel;
  template: string;
  locale: Locale;
  title: string;
  body: string;
  actionUrl: string | null;
  readAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export const NOTIFICATION_SORT_KEYS = ['createdAt', 'readAt'] as const;
export type NotificationSortKey = (typeof NOTIFICATION_SORT_KEYS)[number];

export interface NotificationListQuery extends PaginationQuery {
  unreadOnly?: boolean;
  sortBy?: NotificationSortKey;
}

export interface NotificationCounts {
  unread: number;
  total: number;
}

export interface AdminUser {
  id: Uuid;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  locale: Locale;
  twofaEnabled: boolean;
  emailVerified: boolean;
  lastLoginAt: IsoDateTime | null;
  lastActiveAt: IsoDateTime | null;
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

export interface ChangeUserRoleRequest {
  role: Role;
}

export interface AdminConsumerListItem {
  id: Uuid;
  name: string;
  email: string;
  phone: string | null;
  signedUpAt: IsoDateTime;
  lastActiveAt: IsoDateTime | null;
  generationsThisMonth: number;
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
  hasEnquiries?: boolean;
  sortBy?: ConsumerSortColumn;
}

export interface AdminConsumerProfileSummary {
  eventDate: IsoDate | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  preferredCategories: Uuid[];
  monthlyQuotaOverride: number | null;
  onboardingCompletedAt: IsoDateTime | null;
}

export interface AdminConsumerEnquirySummary {
  id: Uuid;
  reference: string;
  status: EnquiryStatus;
  createdAt: IsoDateTime;
  firstRespondedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
  totalValueSnapshot: number | null;
}

export interface AdminConsumerDetail {
  id: Uuid;
  name: string;
  email: string;
  phone: string | null;
  status: UserStatus;
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

export interface AdminConsumerRender {
  id: Uuid;
  createdAt: IsoDateTime;
  url: string;
  thumbnailUrl: string | null;
  garmentTitle: string;
  garmentCategory: string;
  garmentPrice: number | null;
  garmentCurrency: string;
  width: number;
  height: number;
  enquiryId: Uuid;
  enquiryReference: string;
}

export const ADMIN_RENDER_SORTABLE_COLUMNS = ['createdAt'] as const;
export type AdminRenderSortColumn = (typeof ADMIN_RENDER_SORTABLE_COLUMNS)[number];

export interface AdminConsumerRenderQuery extends PaginationQuery {
  sortBy?: AdminRenderSortColumn;
}

export interface AdminConsumerShortlistItem {
  id: Uuid;
  garmentId: Uuid;
  garmentTitle: string;
  garmentSku: string;
  garmentPrice: number | null;
  garmentCurrency: string;
  verdict: Extract<Verdict, 'LOVE_IT' | 'MAYBE'>;
  rank: number | null;
  note: string | null;
  verdictAt: IsoDateTime;
}

export const ADMIN_SHORTLIST_SORTABLE_COLUMNS = ['rank', 'verdictAt', 'createdAt'] as const;
export type AdminShortlistSortColumn = (typeof ADMIN_SHORTLIST_SORTABLE_COLUMNS)[number];

export interface AdminConsumerShortlistQuery extends PaginationQuery {
  sortBy?: AdminShortlistSortColumn;
}

export interface SetConsumerQuotaOverrideRequest {
  monthlyQuotaOverride: number | null;
}

export interface SuspendConsumerRequest {
  reason?: string;
}

export interface DeleteConsumerRequest {
  confirmName: string;
}

export interface AdminDeletionReceipt {
  deletionLogId: Uuid;
  subjectType: DeletionSubject;
  subjectId: Uuid;
  initiatedBy: DeletionInitiator;
  requestedAt: IsoDateTime;
  dueBy: IsoDateTime;
  sessionsRevoked: number;
}
