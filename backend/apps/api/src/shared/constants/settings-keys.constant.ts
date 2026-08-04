import { SettingsValueType } from '@api/modules/settings/enums/settings-value-type.enum';

/**
 * The closed `settings` key registry (ARCHITECTURE §4.28).
 *
 * An unknown key is `SETTINGS_KEY_UNKNOWN`. Every key declares its value type, its
 * seed default and whether it is exposed by `GET /settings/brand`.
 *
 * Defaults are **product** defaults, not secrets. Three of them (`quota.defaultMonthly`,
 * `budget.monthlyGenerations`, `budget.warnThresholdPercent`) may be overridden at
 * seed time by `QUOTA_DEFAULT_MONTHLY`, `BUDGET_DEFAULT_MONTHLY` and
 * `BUDGET_WARN_PERCENT` (§7); the seeder, not this file, reads the environment.
 */
export const SETTINGS_KEYS = {
  BRAND_NAME: 'brand.name',
  BRAND_LOGO_KEY: 'brand.logoKey',
  BRAND_PRIMARY_COLOR: 'brand.primaryColor',
  BRAND_WHATSAPP_NUMBER: 'brand.whatsappNumber',
  BRAND_INSTAGRAM_HANDLE: 'brand.instagramHandle',
  BRAND_CONTACT_EMAIL: 'brand.contactEmail',
  BRAND_STORE_ADDRESSES: 'brand.storeAddresses',
  QUOTA_DEFAULT_MONTHLY: 'quota.defaultMonthly',
  QUOTA_REQUIRE_EMAIL_VERIFICATION: 'quota.requireEmailVerification',
  BUDGET_MONTHLY_GENERATIONS: 'budget.monthlyGenerations',
  BUDGET_WARN_THRESHOLD_PERCENT: 'budget.warnThresholdPercent',
  CATALOG_SHOW_PRICES_PUBLICLY: 'catalog.showPricesPublicly',
  SHARING_ENABLED: 'sharing.enabled',
  ENQUIRIES_ENABLED: 'enquiries.enabled',
  PHOTOS_MAX_PER_CONSUMER: 'photos.maxPerConsumer',
  QUALITY_MIN_SCORE: 'quality.minScore',
  SHORT_LINK_SLUG: 'shortLink.slug',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export interface SettingDefinition {
  key: SettingsKey;
  valueType: SettingsValueType;
  /** Seed default. `null` means "no default — an admin must supply it" (A-27). */
  defaultValue: unknown;
  description: string;
  /** Exposed by `GET /settings/brand`. */
  isPublic: boolean;
  /** The PRD requirement this key serves. */
  requirement: string;
}

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  {
    key: SETTINGS_KEYS.BRAND_NAME,
    valueType: SettingsValueType.STRING,
    defaultValue: 'Drape',
    description: 'Brand name shown across the consumer and admin experience.',
    isPublic: true,
    requirement: 'A-27',
  },
  {
    key: SETTINGS_KEYS.BRAND_LOGO_KEY,
    valueType: SettingsValueType.STRING,
    defaultValue: null,
    description: 'Storage key of the brand logo under the brand/ prefix.',
    isPublic: true,
    requirement: 'A-27',
  },
  {
    key: SETTINGS_KEYS.BRAND_PRIMARY_COLOR,
    valueType: SettingsValueType.STRING,
    defaultValue: '#71202F',
    description: 'Primary brand colour. Contrast-validated on save (D-20).',
    isPublic: true,
    requirement: 'A-27, D-20',
  },
  {
    key: SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER,
    valueType: SettingsValueType.STRING,
    defaultValue: null,
    description: 'E.164 WhatsApp number used by the one-tap enquiry reply.',
    isPublic: true,
    requirement: 'A-23, A-27',
  },
  {
    key: SETTINGS_KEYS.BRAND_INSTAGRAM_HANDLE,
    valueType: SettingsValueType.STRING,
    defaultValue: null,
    description: 'Instagram handle, without the leading @.',
    isPublic: true,
    requirement: 'A-27',
  },
  {
    key: SETTINGS_KEYS.BRAND_CONTACT_EMAIL,
    valueType: SettingsValueType.STRING,
    defaultValue: null,
    description: 'Public contact email address.',
    isPublic: true,
    requirement: 'A-27',
  },
  {
    key: SETTINGS_KEYS.BRAND_STORE_ADDRESSES,
    valueType: SettingsValueType.JSON,
    defaultValue: [],
    description: 'Store addresses shown on the contact and enquiry screens.',
    isPublic: true,
    requirement: 'A-27',
  },
  {
    key: SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY,
    valueType: SettingsValueType.NUMBER,
    defaultValue: 15,
    description: 'Default monthly generation quota per consumer.',
    isPublic: false,
    requirement: 'A-28, C-5',
  },
  {
    key: SETTINGS_KEYS.QUOTA_REQUIRE_EMAIL_VERIFICATION,
    valueType: SettingsValueType.BOOLEAN,
    defaultValue: true,
    description: 'Require a verified email address before the first generation.',
    isPublic: false,
    requirement: 'A-28, C-3',
  },
  {
    key: SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS,
    valueType: SettingsValueType.NUMBER,
    defaultValue: 2000,
    description: 'System-wide monthly generation budget.',
    isPublic: false,
    requirement: 'A-29',
  },
  {
    key: SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT,
    valueType: SettingsValueType.NUMBER,
    defaultValue: 80,
    description: 'Percentage of the budget at which the soft warning fires.',
    isPublic: false,
    requirement: 'A-29, E-14',
  },
  {
    key: SETTINGS_KEYS.CATALOG_SHOW_PRICES_PUBLICLY,
    valueType: SettingsValueType.BOOLEAN,
    defaultValue: true,
    description: 'Show garment prices to signed-out visitors and on share links.',
    isPublic: true,
    requirement: 'A-30',
  },
  {
    key: SETTINGS_KEYS.SHARING_ENABLED,
    valueType: SettingsValueType.BOOLEAN,
    defaultValue: true,
    description: 'Master switch for share links and voting.',
    isPublic: true,
    requirement: 'A-30',
  },
  {
    key: SETTINGS_KEYS.ENQUIRIES_ENABLED,
    valueType: SettingsValueType.BOOLEAN,
    defaultValue: true,
    description: 'Master switch for enquiry submission.',
    isPublic: true,
    requirement: 'A-30',
  },
  {
    key: SETTINGS_KEYS.PHOTOS_MAX_PER_CONSUMER,
    valueType: SettingsValueType.NUMBER,
    defaultValue: 5,
    description: 'Maximum stored person photos per consumer.',
    isPublic: false,
    requirement: 'C-16',
  },
  {
    key: SETTINGS_KEYS.QUALITY_MIN_SCORE,
    valueType: SettingsValueType.NUMBER,
    defaultValue: 70,
    description: 'Minimum try-on source quality score required to publish.',
    isPublic: false,
    requirement: 'A-10',
  },
  {
    key: SETTINGS_KEYS.SHORT_LINK_SLUG,
    valueType: SettingsValueType.STRING,
    defaultValue: 'drape',
    description: 'Slug used by the in-store QR code and the Instagram bio link.',
    isPublic: true,
    requirement: 'A-32',
  },
];

export const SETTINGS_KEY_VALUES: readonly SettingsKey[] = SETTINGS_REGISTRY.map((s) => s.key);

export function isSettingsKey(candidate: string): candidate is SettingsKey {
  return SETTINGS_KEY_VALUES.includes(candidate as SettingsKey);
}
