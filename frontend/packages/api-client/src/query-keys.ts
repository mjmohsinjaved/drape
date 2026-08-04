/**
 * The one query-key factory — ARCHITECTURE.md §6.4.
 *
 * Hierarchical, `as const`, one root per domain, so invalidation is surgical.
 *
 * **Rule: a mutation invalidates the narrowest key that covers what changed.** Recording a verdict
 * invalidates `results.detail(id)`, `results.lists()` and `shortlist.list()` — never
 * `results.all`. Every root is a plain array so `queryClient.invalidateQueries({ queryKey })` does
 * prefix matching for free.
 */

import type { AnalyticsRangeQuery } from './types/analytics';
import type { AuditLogQuery } from './types/audit';
import type { CatalogFilters } from './types/catalog';
import type { LedgerPeriod, Uuid } from './types/common';
import type { AdminEnquiryListQuery, MyEnquiryListQuery } from './types/enquiries';
import type { Locale } from './types/enums';
import type { AdminGarmentListQuery } from './types/garments';
import type { InviteListQuery } from './types/invites';
import type { AbuseListQuery, ModerationListQuery } from './types/moderation';
import type { QuotaLedgerQuery, UsageLedgerQuery } from './types/quota';
import type { HistoryFilters } from './types/results';
import type { TryOnJobListQuery } from './types/tryon';
import type {
  AdminConsumerListQuery,
  AdminUserListQuery,
  NotificationListQuery,
} from './types/users';

export const queryKeys = {
  /* ------------------------------------------------------------------ §5.1 auth */
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
    sessions: () => [...queryKeys.auth.all, 'sessions'] as const,
    csrf: () => [...queryKeys.auth.all, 'csrf'] as const,
  },

  /* --------------------------------------------------------- §5.2 users — self */
  me: {
    all: ['me'] as const,
    account: () => [...queryKeys.me.all, 'account'] as const,
    profile: () => [...queryKeys.me.all, 'profile'] as const,
    notificationPreferences: () => [...queryKeys.me.all, 'notification-preferences'] as const,
    data: () => [...queryKeys.me.all, 'data'] as const,
    exports: () => [...queryKeys.me.all, 'export'] as const,
    export: (exportId: Uuid) => [...queryKeys.me.exports(), exportId] as const,
  },

  notifications: {
    all: ['notifications'] as const,
    lists: () => [...queryKeys.notifications.all, 'list'] as const,
    list: (filters?: NotificationListQuery) => [...queryKeys.notifications.lists(), filters ?? {}] as const,
    unreadCount: () => [...queryKeys.notifications.all, 'unread-count'] as const,
  },

  /* -------------------------------------------------- §5.2 users — admin users */
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (filters?: AdminUserListQuery) => [...queryKeys.users.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (userId: Uuid) => [...queryKeys.users.details(), userId] as const,
  },

  /* ---------------------------------------------- §5.2 users — admin consumers */
  consumers: {
    all: ['consumers'] as const,
    lists: () => [...queryKeys.consumers.all, 'list'] as const,
    list: (filters?: AdminConsumerListQuery) => [...queryKeys.consumers.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.consumers.all, 'detail'] as const,
    detail: (userId: Uuid) => [...queryKeys.consumers.details(), userId] as const,
    renders: (userId: Uuid) => [...queryKeys.consumers.detail(userId), 'renders'] as const,
    shortlist: (userId: Uuid) => [...queryKeys.consumers.detail(userId), 'shortlist'] as const,
    quotaLedger: (userId: Uuid, filters?: QuotaLedgerQuery) =>
      [...queryKeys.consumers.detail(userId), 'quota-ledger', filters ?? {}] as const,
  },

  /* --------------------------------------------------------------- §5.3 invites */
  invites: {
    all: ['invites'] as const,
    lists: () => [...queryKeys.invites.all, 'list'] as const,
    list: (filters?: InviteListQuery) => [...queryKeys.invites.lists(), filters ?? {}] as const,
    token: (token: string) => [...queryKeys.invites.all, 'token', token] as const,
  },

  /* -------------------------------------------------------------- §5.4 settings */
  settings: {
    all: ['settings'] as const,
    brand: () => [...queryKeys.settings.all, 'brand'] as const,
    admin: () => [...queryKeys.settings.all, 'admin'] as const,
    qr: () => [...queryKeys.settings.all, 'qr'] as const,
    shortLink: () => [...queryKeys.settings.all, 'short-link'] as const,
    policy: () => [...queryKeys.settings.all, 'policy'] as const,
  },

  /* ------------------------------------------------------------ §5.5 categories */
  categories: {
    all: ['categories'] as const,
    tree: (scope: 'public' | 'admin') => [...queryKeys.categories.all, 'tree', scope] as const,
    details: () => [...queryKeys.categories.all, 'detail'] as const,
    detail: (categoryId: Uuid) => [...queryKeys.categories.details(), categoryId] as const,
  },

  /* ---------------------------------------- §5.6 garments · §5.7 garment-images */
  garments: {
    all: ['garments'] as const,
    lists: () => [...queryKeys.garments.all, 'list'] as const,
    list: (filters?: AdminGarmentListQuery) => [...queryKeys.garments.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.garments.all, 'detail'] as const,
    detail: (garmentId: Uuid) => [...queryKeys.garments.details(), garmentId] as const,
    images: (garmentId: Uuid) => [...queryKeys.garments.detail(garmentId), 'images'] as const,
    health: () => [...queryKeys.garments.all, 'catalog-health'] as const,
  },

  /* -------------------------------------------------------------- §5.8 catalog */
  catalog: {
    all: ['catalog'] as const,
    lists: () => [...queryKeys.catalog.all, 'list'] as const,
    list: (filters?: CatalogFilters) => [...queryKeys.catalog.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.catalog.all, 'detail'] as const,
    detail: (idOrSlug: string) => [...queryKeys.catalog.details(), idOrSlug] as const,
    facets: () => [...queryKeys.catalog.all, 'facets'] as const,
    newArrivals: (limit?: number) => [...queryKeys.catalog.all, 'new-arrivals', limit ?? null] as const,
  },

  /* -------------------------------------------------------- §5.9 person-photos */
  photos: {
    all: ['person-photos'] as const,
    list: () => [...queryKeys.photos.all, 'list'] as const,
    details: () => [...queryKeys.photos.all, 'detail'] as const,
    detail: (photoId: Uuid) => [...queryKeys.photos.details(), photoId] as const,
  },

  /* ------------------------------------------------------------- §5.10 consents */
  consent: {
    all: ['consent'] as const,
    me: () => [...queryKeys.consent.all, 'me'] as const,
    policy: (locale: Locale) => [...queryKeys.consent.all, 'policy', locale] as const,
  },

  /* ---------------------------------------------------------------- §5.11 tryon */
  tryon: {
    all: ['tryon'] as const,
    jobs: (filters?: TryOnJobListQuery) => [...queryKeys.tryon.all, 'jobs', filters ?? {}] as const,
    job: (jobId: Uuid) => [...queryKeys.tryon.all, 'job', jobId] as const,
    referenceModels: () => [...queryKeys.tryon.all, 'reference-models'] as const,
    batch: (batchId: Uuid) => [...queryKeys.tryon.all, 'batch', batchId] as const,
  },

  /* -------------------------------------------------------------- §5.12 results */
  results: {
    all: ['results'] as const,
    lists: () => [...queryKeys.results.all, 'list'] as const,
    list: (filters?: HistoryFilters) => [...queryKeys.results.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.results.all, 'detail'] as const,
    detail: (resultId: Uuid) => [...queryKeys.results.details(), resultId] as const,
    byPhoto: () => [...queryKeys.results.all, 'by-photo'] as const,
  },

  /* ------------------------------------------------------------ §5.13 shortlist */
  shortlist: {
    all: ['shortlist'] as const,
    list: () => [...queryKeys.shortlist.all, 'list'] as const,
  },

  /* ------------------------------------------------- §5.14 share · public votes */
  share: {
    all: ['share'] as const,
    links: () => [...queryKeys.share.all, 'links'] as const,
    link: (shareLinkId: Uuid) => [...queryKeys.share.links(), shareLinkId] as const,
    votes: (shareLinkId: Uuid) => [...queryKeys.share.link(shareLinkId), 'votes'] as const,
    publicView: (token: string) => [...queryKeys.share.all, 'public', token] as const,
    publicVotes: (token: string) => [...queryKeys.share.publicView(token), 'votes'] as const,
  },

  /* ------------------------------------------------------------ §5.15 enquiries */
  enquiries: {
    all: ['enquiries'] as const,
    mine: (filters?: MyEnquiryListQuery) => [...queryKeys.enquiries.all, 'mine', filters ?? {}] as const,
    adminLists: () => [...queryKeys.enquiries.all, 'admin-list'] as const,
    adminList: (filters?: AdminEnquiryListQuery) =>
      [...queryKeys.enquiries.adminLists(), filters ?? {}] as const,
    details: () => [...queryKeys.enquiries.all, 'detail'] as const,
    detail: (enquiryId: Uuid) => [...queryKeys.enquiries.details(), enquiryId] as const,
    notes: (enquiryId: Uuid) => [...queryKeys.enquiries.detail(enquiryId), 'notes'] as const,
    whatsappLink: (enquiryId: Uuid) =>
      [...queryKeys.enquiries.detail(enquiryId), 'whatsapp-link'] as const,
  },

  /* ------------------------------------------------------- §5.16 quota · budget */
  quota: {
    all: ['quota'] as const,
    me: () => [...queryKeys.quota.all, 'me'] as const,
    adminUsage: (period?: LedgerPeriod) => [...queryKeys.quota.all, 'admin-usage', period ?? null] as const,
    adminLedger: (filters?: UsageLedgerQuery) =>
      [...queryKeys.quota.all, 'admin-ledger', filters ?? {}] as const,
  },

  /* --------------------------------------------------- §5.17 moderation · abuse */
  moderation: {
    all: ['moderation'] as const,
    lists: () => [...queryKeys.moderation.all, 'list'] as const,
    list: (filters?: ModerationListQuery) => [...queryKeys.moderation.lists(), filters ?? {}] as const,
    details: () => [...queryKeys.moderation.all, 'detail'] as const,
    detail: (itemId: Uuid) => [...queryKeys.moderation.details(), itemId] as const,
    abuse: (filters?: AbuseListQuery) => [...queryKeys.moderation.all, 'abuse', filters ?? {}] as const,
    ipBlocks: () => [...queryKeys.moderation.all, 'ip-blocks'] as const,
  },

  /* ------------------------------------------------------------ §5.18 analytics */
  analytics: {
    all: ['analytics'] as const,
    overview: () => [...queryKeys.analytics.all, 'overview'] as const,
    funnel: (range?: AnalyticsRangeQuery) => [...queryKeys.analytics.all, 'funnel', range ?? {}] as const,
    garments: (range?: AnalyticsRangeQuery) => [...queryKeys.analytics.all, 'garments', range ?? {}] as const,
    rejections: (range?: AnalyticsRangeQuery) =>
      [...queryKeys.analytics.all, 'rejection-reasons', range ?? {}] as const,
    categories: (range?: AnalyticsRangeQuery) =>
      [...queryKeys.analytics.all, 'categories', range ?? {}] as const,
    activity: (range?: AnalyticsRangeQuery) => [...queryKeys.analytics.all, 'activity', range ?? {}] as const,
    generationHealth: (range?: AnalyticsRangeQuery) =>
      [...queryKeys.analytics.all, 'generation-health', range ?? {}] as const,
  },

  /* ---------------------------------------------------------------- §5.19 audit */
  audit: {
    all: ['audit'] as const,
    lists: () => [...queryKeys.audit.all, 'list'] as const,
    list: (filters?: AuditLogQuery) => [...queryKeys.audit.lists(), filters ?? {}] as const,
    actions: () => [...queryKeys.audit.all, 'actions'] as const,
  },

  /* --------------------------------------------------------------- §5.21 health */
  health: {
    all: ['health'] as const,
    liveness: () => [...queryKeys.health.all, 'liveness'] as const,
    readiness: () => [...queryKeys.health.all, 'readiness'] as const,
    metrics: () => [...queryKeys.health.all, 'metrics'] as const,
  },
} as const;

/** Every key the factory can produce. Useful for typing an `invalidateKeys` array. */
export type QueryKeys = typeof queryKeys;

/** The root of every domain, for the rare case where a whole domain really must be dropped. */
export type QueryKeyRoot = keyof QueryKeys;
