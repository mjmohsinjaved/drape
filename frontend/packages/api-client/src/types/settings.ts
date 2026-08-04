/**
 * ARCHITECTURE.md §5.4 `settings` and the closed key registry of §4.28.
 *
 * The key registry is closed: an unknown key is `SETTINGS_KEY_UNKNOWN`. `SettingsKey` below
 * mirrors it exactly, so a typo in the web app is a compile error rather than a 400.
 */

import { type IsoDateTime, type Uuid } from './common';
import { type Locale, type SettingsValueType } from './enums';

/** §4.28 — the complete settings key registry. */
export const SETTINGS_KEYS = [
  'brand.name',
  'brand.logoKey',
  'brand.primaryColor',
  'brand.whatsappNumber',
  'brand.instagramHandle',
  'brand.contactEmail',
  'brand.storeAddresses',
  'quota.defaultMonthly',
  'quota.requireEmailVerification',
  'budget.monthlyGenerations',
  'budget.warnThresholdPercent',
  'catalog.showPricesPublicly',
  'sharing.enabled',
  'enquiries.enabled',
  'photos.maxPerConsumer',
  'quality.minScore',
  'shortLink.slug',
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/** A store address as `brand.storeAddresses` stores it (A-27). */
export interface StoreAddress {
  label: string;
  addressLine: string;
  city: string;
  phone?: string;
  mapsUrl?: string;
}

/**
 * `GET /settings/brand` (PUBLIC) — the config the web app themes from. Deliberately narrow: this
 * is the only settings shape an unauthenticated browser ever sees.
 */
export interface BrandSettings {
  name: string;
  /** Signed URL for the logo, or null when none is set. The raw storage key never leaves the API. */
  logoUrl: string | null;
  primaryColor: string;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  contactEmail: string | null;
  storeAddresses: StoreAddress[];
  /** A-30 toggles the web app must honour in its own rendering as well as the API enforcing them. */
  showPricesPublicly: boolean;
  sharingEnabled: boolean;
  enquiriesEnabled: boolean;
}

/** One row of `GET /settings` (ADMIN) — the full settings map (A-27…A-30). */
export interface SettingEntry {
  key: SettingsKey;
  value: unknown;
  valueType: SettingsValueType;
  description: string;
  isPublic: boolean;
  updatedByName: string | null;
  updatedAt: IsoDateTime;
}

/**
 * `GET /settings` (ADMIN). Returned as an array so `valueType` and `description` travel with each
 * key; the UI maps it to a record when it needs one.
 */
export interface AdminSettingsResponse {
  settings: SettingEntry[];
}

/**
 * `PATCH /settings` (ADMIN) — update one or more keys. Validated against the key registry and
 * audit-logged. An unknown key is `SETTINGS_KEY_UNKNOWN`; a bad value is `SETTINGS_VALUE_INVALID`.
 */
export interface UpdateSettingsRequest {
  settings: Partial<Record<SettingsKey, unknown>>;
}

/** `POST /settings/brand/logo` (ADMIN) — finalises a brand-asset upload and sets `brand.logoKey`. */
export interface FinaliseBrandLogoRequest {
  /** The upload ticket that was redeemed by `PUT /files/upload/:ticket` (§3.5). */
  ticket: string;
}

export interface FinaliseBrandLogoResponse {
  logoUrl: string;
}

/** `GET /settings/qr` (ADMIN) — PNG QR code for in-store signage (A-32). */
export interface BrandQrCodeResponse {
  /** `data:image/png;base64,…`, so the admin can save or print it without a second request. */
  pngDataUrl: string;
  targetUrl: string;
}

/** `GET /settings/short-link` (ADMIN) — the copyable Instagram-bio short link (A-32). */
export interface ShortLinkResponse {
  slug: string;
  url: string;
}

/** `GET /settings/policy` (ADMIN) — the current policy version and body (§4.10). */
export interface PolicyVersionDetail {
  id: Uuid;
  version: string;
  effectiveFrom: IsoDateTime;
  isCurrent: boolean;
  bodyEn: string;
  bodyUr: string;
  summaryEn: string;
  summaryUr: string;
  retentionSummary: PolicyRetention;
  createdAt: IsoDateTime;
}

/** §4.10 `policy_versions.retentionSummary`, C-11. */
export interface PolicyRetention {
  photoDays: number;
  rendersLifetime: boolean;
}

/**
 * `POST /settings/policy` (ADMIN) — publish a new policy version. **Triggers re-consent for
 * everyone** (C-12), so the UI confirms before sending.
 */
export interface PublishPolicyVersionRequest {
  version: string;
  effectiveFrom?: IsoDateTime;
  bodyEn: string;
  bodyUr: string;
  summaryEn: string;
  summaryUr: string;
  retentionSummary: PolicyRetention;
}

/** The locale a policy body is requested in (`GET /consents/policy`). */
export interface PolicyLocaleQuery {
  locale?: Locale;
}
