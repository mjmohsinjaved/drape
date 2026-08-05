import type { Locale } from '@/i18n/config';

/**
 * The typed route map — ARCHITECTURE §6.6.
 *
 * **This file is the only place a Drape URL is written down.** Nothing else in the app
 * builds a path from string parts: not a `<Link href>`, not a `redirect()`, not a metadata
 * canonical, not the middleware. If a route changes shape, it changes here once.
 *
 * Every route carries its locale, because `[locale]` is a root segment that is always
 * present in the URL (§6.7).
 *
 * ═══ The one navigation convention ═══
 *
 * **A builder here returns a finished, locale-prefixed URL, and it is handed to the plain
 * `next/link` and `next/navigation` primitives.** Nothing in the app navigates through
 * `next-intl`'s `createNavigation` helpers.
 *
 * That is not a preference, it is the only combination that works. `routing` declares
 * `localePrefix: 'always'`, so every next-intl primitive *prepends* the active locale to the
 * href it is given. Handed `/en/renders/x` — which is what every builder below returns — it
 * produces `/en/en/renders/x`, a path that matches no route and falls through to the root
 * `not-found.tsx`. The reveal at the end of a try-on was landing there (PRD §10.3).
 *
 * The locale has to live here rather than in the navigation layer, because `generateMetadata`,
 * `middleware.ts` and every server-side `redirect()` need a complete URL and cannot call a React
 * hook. One prefixed route map plus locale-agnostic primitives is a single rule; a prefixed map
 * for the server and a bare one for the client is two, and mixing them is what shipped.
 *
 * `@repo/config-eslint`'s `no-restricted-imports` entry for `next-intl/navigation` keeps it that
 * way, and `routes.test.ts` pins both halves of the invariant.
 */

const root = (locale: Locale): string => `/${locale}`;

export const routes = {
  /** Public landing — featured categories and new arrivals, reachable signed out (C-1). */
  home: (locale: Locale): string => root(locale),

  // --- Public browse (C-1, C-17, C-18, C-33) --------------------------------------------
  browse: (locale: Locale): string => `${root(locale)}/browse`,
  browseCategory: (locale: Locale, categorySlug: string): string =>
    `${root(locale)}/browse/${categorySlug}`,
  garment: (locale: Locale, slug: string): string => `${root(locale)}/garments/${slug}`,
  sharedView: (locale: Locale, token: string): string => `${root(locale)}/s/${token}`,

  // --- Auth (S-1, S-4, S-5, S-6, S-8) ---------------------------------------------------
  login: (locale: Locale): string => `${root(locale)}/login`,
  signup: (locale: Locale): string => `${root(locale)}/signup`,
  forgotPassword: (locale: Locale): string => `${root(locale)}/forgot-password`,
  resetPassword: (locale: Locale): string => `${root(locale)}/reset-password`,
  resetPasswordToken: (locale: Locale, token: string): string =>
    `${root(locale)}/reset-password/${token}`,
  verifyEmail: (locale: Locale): string => `${root(locale)}/verify-email`,
  verifyEmailToken: (locale: Locale, token: string): string =>
    `${root(locale)}/verify-email/${token}`,
  twoFactor: (locale: Locale): string => `${root(locale)}/two-factor`,
  invite: (locale: Locale, token: string): string => `${root(locale)}/invite/${token}`,

  /**
   * One dashboard URL for both roles (S-2). The role is resolved server-side and decides
   * which shell renders; the URL is identical for an admin and a consumer.
   */
  dashboard: (locale: Locale): string => `${root(locale)}/dashboard`,

  // --- Consumer fitting room ------------------------------------------------------------
  consent: (locale: Locale): string => `${root(locale)}/consent`,
  photos: (locale: Locale): string => `${root(locale)}/photos`,
  photoNew: (locale: Locale): string => `${root(locale)}/photos/new`,
  renders: (locale: Locale): string => `${root(locale)}/renders`,
  render: (locale: Locale, resultId: string): string => `${root(locale)}/renders/${resultId}`,
  tryOnJob: (locale: Locale, jobId: string): string => `${root(locale)}/tryon/${jobId}`,
  shortlist: (locale: Locale): string => `${root(locale)}/shortlist`,
  shareLinks: (locale: Locale): string => `${root(locale)}/share`,
  enquiries: (locale: Locale): string => `${root(locale)}/enquiries`,
  enquiryNew: (locale: Locale): string => `${root(locale)}/enquiries/new`,
  account: (locale: Locale): string => `${root(locale)}/account`,
  accountSecurity: (locale: Locale): string => `${root(locale)}/account/security`,
  accountNotifications: (locale: Locale): string => `${root(locale)}/account/notifications`,
  /** Everything stored about her, export and delete (C-37…C-40). */
  accountData: (locale: Locale): string => `${root(locale)}/account/data`,

  // --- Admin console --------------------------------------------------------------------
  admin: {
    root: (locale: Locale): string => `${root(locale)}/admin`,
    categories: (locale: Locale): string => `${root(locale)}/admin/categories`,
    catalog: (locale: Locale): string => `${root(locale)}/admin/catalog`,
    catalogNew: (locale: Locale): string => `${root(locale)}/admin/catalog/new`,
    catalogHealth: (locale: Locale): string => `${root(locale)}/admin/catalog/health`,
    garment: (locale: Locale, garmentId: string): string =>
      `${root(locale)}/admin/catalog/${garmentId}`,
    garmentTestRender: (locale: Locale, garmentId: string): string =>
      `${root(locale)}/admin/catalog/${garmentId}/test-render`,
    consumers: (locale: Locale): string => `${root(locale)}/admin/consumers`,
    consumer: (locale: Locale, userId: string): string => `${root(locale)}/admin/consumers/${userId}`,
    enquiries: (locale: Locale): string => `${root(locale)}/admin/enquiries`,
    enquiry: (locale: Locale, enquiryId: string): string =>
      `${root(locale)}/admin/enquiries/${enquiryId}`,
    moderation: (locale: Locale): string => `${root(locale)}/admin/moderation`,
    abuse: (locale: Locale): string => `${root(locale)}/admin/abuse`,
    usage: (locale: Locale): string => `${root(locale)}/admin/usage`,
    analytics: (locale: Locale): string => `${root(locale)}/admin/analytics`,
    audit: (locale: Locale): string => `${root(locale)}/admin/audit`,
    team: (locale: Locale): string => `${root(locale)}/admin/team`,
    settings: (locale: Locale): string => `${root(locale)}/admin/settings`,
    settingsPolicy: (locale: Locale): string => `${root(locale)}/admin/settings/policy`,
    preview: (locale: Locale): string => `${root(locale)}/admin/preview`,
  },

  // --- System screens -------------------------------------------------------------------
  /** The S-9 screen. Plain language, a link back to the fitting room, never a raw 403. */
  noAccess: (locale: Locale): string => `${root(locale)}/no-access`,
  offline: (locale: Locale): string => `${root(locale)}/offline`,
} as const;

/**
 * Path segments (locale stripped) that require a session for the *interface* to make sense.
 * Used by `middleware.ts` for a convenience redirect only — never as the authorisation
 * decision (S-3, B-10). Every page below re-verifies server-side and every data operation is
 * independently authorised by the API.
 */
export const PROTECTED_SEGMENTS = [
  'dashboard',
  'admin',
  'consent',
  'photos',
  'renders',
  'tryon',
  'shortlist',
  'share',
  'enquiries',
  'account',
] as const;

/** Segments an authenticated user should be bounced away from, back to `/dashboard`. */
export const AUTH_ONLY_SEGMENTS = ['login', 'signup', 'forgot-password', 'reset-password'] as const;

/** Segments that must never be indexed, whatever else their metadata says. */
export const NOINDEX_SEGMENTS = [
  ...PROTECTED_SEGMENTS,
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'verify-email',
  'two-factor',
  'invite',
  's',
  'no-access',
  'offline',
] as const;

/**
 * API paths this app calls from the server before `@repo/api-client`'s generated endpoint map
 * is reachable — the session probe and the public brand config. Everything else goes through
 * `@repo/api-client` (ARCHITECTURE §5, §6.4).
 */
export const apiPaths = {
  authMe: '/auth/me',
  brandSettings: '/settings/brand',
} as const;

/** Strips the leading `/{locale}` from a pathname, returning `/` for the locale root. */
export function stripLocale(pathname: string): string {
  const withoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '');
  return withoutLocale === '' ? '/' : withoutLocale;
}

/** The first path segment after the locale, e.g. `/en/admin/catalog` → `admin`. */
export function firstSegment(pathname: string): string {
  return stripLocale(pathname).split('/').filter(Boolean)[0] ?? '';
}

export function isProtectedPath(pathname: string): boolean {
  const segment = firstSegment(pathname);
  return (PROTECTED_SEGMENTS as readonly string[]).includes(segment);
}

export function isAuthOnlyPath(pathname: string): boolean {
  const segment = firstSegment(pathname);
  return (AUTH_ONLY_SEGMENTS as readonly string[]).includes(segment);
}

export function isNoIndexPath(pathname: string): boolean {
  const segment = firstSegment(pathname);
  return (NOINDEX_SEGMENTS as readonly string[]).includes(segment);
}
