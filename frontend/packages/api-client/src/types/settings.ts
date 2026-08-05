/**
 * ARCHITECTURE.md §5.4 `settings` and the closed key registry of §4.28.
 *
 * The key registry is closed: an unknown key is `SETTINGS_KEY_UNKNOWN`. `SettingsKey` below
 * mirrors it exactly, so a typo in the web app is a compile error rather than a 400.
 */

import type { IsoDateTime, Uuid } from './common';
import type { Locale, SettingsValueType } from './enums';

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
  address: string;
  city?: string;
  phone?: string;
  mapUrl?: string;
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
  /** A-32 — the in-store QR / bio-link slug. */
  shortLinkSlug: string;
}

/** One row of `GET /settings` (ADMIN) — the full settings list (A-27…A-30). A flat array, not
 * wrapped: `GET` and `PATCH /settings` both return `SettingEntry[]` directly. */
export interface SettingEntry {
  key: SettingsKey;
  /** The stored value, or the registry default when no row exists yet. */
  value: unknown;
  valueType: SettingsValueType;
  description: string;
  /** Exposed by `GET /settings/brand`. */
  isPublic: boolean;
  /** The PRD requirement this key serves, e.g. `'A-28, C-5'`. */
  requirement: string;
  /** The admin who last changed it. Null while the seeded value stands. */
  updatedBy: Uuid | null;
  updatedAt: IsoDateTime | null;
}

/** One key/value change of `PATCH /settings` (ADMIN). */
export interface SettingChange {
  /** A key from the closed registry. An unknown key is `SETTINGS_KEY_UNKNOWN`. */
  key: SettingsKey;
  /** Validated against the key's registry definition. `null` clears an optional key. */
  value: unknown;
}

/**
 * `PATCH /settings` (ADMIN) — update one or more keys in a single batch. Every key is validated
 * before any of them is written. A bad value is `SETTINGS_VALUE_INVALID`.
 */
export interface UpdateSettingsRequest {
  changes: SettingChange[];
}

/**
 * `POST /settings/brand/logo` (ADMIN) — finalises a brand-asset upload and sets `brand.logoKey`.
 * The bytes never pass through this endpoint: the admin redeems an upload ticket via
 * `PUT /files/upload/:ticket` (§3.5) first and posts the resulting storage key here.
 */
export interface FinaliseBrandLogoRequest {
  /** The storage key returned by the upload ticket redemption. Must live under `brand/`. */
  key: string;
}

/** The updated `brand.logoKey` setting row. */
export type FinaliseBrandLogoResponse = SettingEntry;

/** `GET /settings/qr` (ADMIN) — PNG QR code for in-store signage (A-32). */
export interface BrandQrCodeResponse {
  slug: string;
  targetUrl: string;
  /** PNG, base64, as a data URL — renders in an `<img>`, no second authenticated request to print it. */
  dataUrl: string;
}

/** `GET /settings/short-link` (ADMIN) — the copyable Instagram-bio short link (A-32). */
export interface ShortLinkResponse {
  slug: string;
  url: string;
}

/**
 * A-31 preview mode, as `GET`/`PUT /settings/preview` (ADMIN) return it. Scoped to **one admin**,
 * not the platform: it is session-lifetime state, not a `settings` row, so two admins may disagree
 * about whether they are previewing.
 */
export interface PreviewModeState {
  enabled: boolean;
  /** When the flag lapses on its own. Null when preview mode is off. */
  expiresAt: IsoDateTime | null;
}

/** `PUT /settings/preview` (ADMIN) — view the consumer experience without spending generations. */
export interface SetPreviewModeRequest {
  enabled: boolean;
}

/**
 * `GET /settings/policy` (ADMIN) — the current policy version and body, both translations. This
 * route lives on `PolicyAdminController`, mounted under `/settings/policy` but owned by the
 * `consents` module (§4.33) — publishing and gating stay in one place.
 */
export interface PolicyVersionDetail {
  id: Uuid;
  version: string;
  effectiveFrom: IsoDateTime;
  /** Exactly one version is current at a time (§4.10). */
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
 * everyone** (C-12), so the UI confirms before sending. The response is a {@link PolicyVersionDetail}.
 */
export interface PublishPolicyVersionRequest {
  version: string;
  /** Defaults to now. A future date still becomes current immediately. */
  effectiveFrom?: IsoDateTime;
  bodyEn: string;
  bodyUr: string;
  summaryEn: string;
  summaryUr: string;
  retentionSummary: PolicyRetention;
}

/** The locale a policy body is requested in (`GET /consents/policy`, owned by `consents.ts`). */
export interface PolicyLocaleQuery {
  locale?: Locale;
}
