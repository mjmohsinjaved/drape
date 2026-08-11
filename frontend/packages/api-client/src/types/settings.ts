

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

export interface BrandSettings {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  contactEmail: string | null;
  storeAddresses: StoreAddress[];
  showPricesPublicly: boolean;
  sharingEnabled: boolean;
  enquiriesEnabled: boolean;
  shortLinkSlug: string;
}

export interface SettingEntry {
  key: SettingsKey;
  value: unknown;
  valueType: SettingsValueType;
  description: string;
  isPublic: boolean;
  requirement: string;
  updatedBy: Uuid | null;
  updatedAt: IsoDateTime | null;
}

export interface SettingChange {
  key: SettingsKey;
  value: unknown;
}

export interface UpdateSettingsRequest {
  changes: SettingChange[];
}

export interface FinaliseBrandLogoRequest {
  key: string;
}

export type FinaliseBrandLogoResponse = SettingEntry;

export interface BrandQrCodeResponse {
  slug: string;
  targetUrl: string;
  dataUrl: string;
}

export interface ShortLinkResponse {
  slug: string;
  url: string;
}

export interface PreviewModeState {
  enabled: boolean;
  expiresAt: IsoDateTime | null;
}

export interface SetPreviewModeRequest {
  enabled: boolean;
}

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

export interface PolicyLocaleQuery {
  locale?: Locale;
}
