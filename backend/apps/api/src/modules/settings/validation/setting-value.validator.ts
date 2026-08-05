import { ErrorCode, ValidationException } from '@library/common';

import { SettingsValueType } from '@api/modules/settings/enums/settings-value-type.enum';
import {
  SETTINGS_KEYS,
  SETTINGS_REGISTRY,
  isSettingsKey,
  type SettingDefinition,
  type SettingsKey,
} from '@api/shared/constants/settings-keys.constant';

/**
 * Registry-driven validation for `PATCH /api/v1/settings` (§4.28, §5.4).
 *
 * `SETTINGS_REGISTRY` is the single, closed list of keys — this file adds nothing to
 * it. It answers two questions the registry deliberately does not: *is this a real
 * key* (`SETTINGS_KEY_UNKNOWN`) and *is this a legal value for it*
 * (`SETTINGS_VALUE_INVALID`).
 *
 * Every rule below exists because the value is read somewhere that cannot cope with
 * nonsense: a `primaryColor` that is not a hex triple breaks the D-20 contrast check,
 * a `whatsappNumber` that is not E.164 produces a `wa.me` link that 404s, and a
 * negative `quota.defaultMonthly` would hand every consumer an unusable account.
 */

/** `#rrggbb`. The D-20 contrast check runs against this, so the short form is out. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** E.164: a leading `+`, a non-zero country code, 8–15 digits in total. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** An Instagram handle without the leading `@` (§4.28). */
const INSTAGRAM_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._]{0,29}$/;

/** Deliberately loose. The address is displayed, not authenticated — see A-27. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/** A URL-safe slug for the QR target and the Instagram bio link (A-32). */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** `brand/<uuid>.<ext>` — the only prefix a brand asset may live under (§3.3). */
const BRAND_KEY_PATTERN = /^brand\/[a-z0-9][a-z0-9\-/]*\.[a-z0-9]{2,5}$/;

const MAX_BRAND_NAME_LENGTH = 80;
const MAX_STORE_ADDRESSES = 20;
const MAX_ADDRESS_FIELD_LENGTH = 200;

/** One store address as A-27 stores it in `brand.storeAddresses`. */
export interface BrandAddress {
  label: string;
  address: string;
  city?: string;
  phone?: string;
  mapUrl?: string;
}

/** Every registry definition, indexed. Built once — the registry is immutable. */
const DEFINITION_BY_KEY: ReadonlyMap<SettingsKey, SettingDefinition> = new Map(
  SETTINGS_REGISTRY.map((definition) => [definition.key, definition]),
);

/** The public projection's source of truth: the registry, filtered. Never a second list. */
export const PUBLIC_SETTING_DEFINITIONS: readonly SettingDefinition[] = SETTINGS_REGISTRY.filter(
  (definition) => definition.isPublic,
);

/**
 * Resolves a client-supplied key against the closed registry.
 *
 * @throws ValidationException `SETTINGS_KEY_UNKNOWN` — 400, "Unknown setting."
 */
export function definitionFor(key: string): SettingDefinition {
  if (!isSettingsKey(key)) {
    throw new ValidationException(ErrorCode.SETTINGS_KEY_UNKNOWN, {
      details: { key },
    });
  }
  const definition = DEFINITION_BY_KEY.get(key);
  if (definition === undefined) {
    /* istanbul ignore next — isSettingsKey() and the map are built from one array. */
    throw new ValidationException(ErrorCode.SETTINGS_KEY_UNKNOWN, { details: { key } });
  }
  return definition;
}

/**
 * Validates a value against its registry definition and returns the value to store.
 *
 * `null` is accepted only for a key whose registry default is `null` — the A-27 keys
 * an admin must supply and may therefore also clear. Everything else must hold a
 * value, because the rest of the product reads it without a fallback.
 *
 * @throws ValidationException `SETTINGS_VALUE_INVALID`
 */
export function validateSettingValue(definition: SettingDefinition, value: unknown): unknown {
  if (value === null || value === undefined) {
    if (definition.defaultValue !== null) {
      throw invalid(definition, 'This setting cannot be cleared.');
    }
    return null;
  }

  switch (definition.valueType) {
    case SettingsValueType.STRING:
      return validateString(definition, value);
    case SettingsValueType.NUMBER:
      return validateNumber(definition, value);
    case SettingsValueType.BOOLEAN:
      if (typeof value !== 'boolean') {
        throw invalid(definition, 'Expected true or false.');
      }
      return value;
    case SettingsValueType.JSON:
      return validateJson(definition, value);
    default:
      /* istanbul ignore next — SettingsValueType is closed (§4.1). */
      throw invalid(definition, 'Unsupported value type.');
  }
}

function validateString(definition: SettingDefinition, value: unknown): string {
  if (typeof value !== 'string') {
    throw invalid(definition, 'Expected text.');
  }
  const trimmed = value.trim();

  switch (definition.key) {
    case SETTINGS_KEYS.BRAND_NAME:
      if (trimmed.length === 0 || trimmed.length > MAX_BRAND_NAME_LENGTH) {
        throw invalid(definition, `Enter a brand name of 1–${MAX_BRAND_NAME_LENGTH} characters.`);
      }
      return trimmed;

    case SETTINGS_KEYS.BRAND_PRIMARY_COLOR:
      if (!HEX_COLOR_PATTERN.test(trimmed)) {
        throw invalid(definition, 'Enter a six-digit hex colour, for example #71202F.');
      }
      return trimmed.toUpperCase();

    case SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER:
      if (!E164_PATTERN.test(trimmed)) {
        throw invalid(
          definition,
          'Enter the number in international format, for example +923001234567.',
        );
      }
      return trimmed;

    case SETTINGS_KEYS.BRAND_INSTAGRAM_HANDLE: {
      // An admin will paste `@drape` or the whole profile URL. Both mean the handle.
      const handle = trimmed
        .replace(/^@/, '')
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
        .replace(/\/+$/, '');
      if (!INSTAGRAM_HANDLE_PATTERN.test(handle)) {
        throw invalid(definition, 'Enter the handle without the @, for example drape.studio.');
      }
      return handle;
    }

    case SETTINGS_KEYS.BRAND_CONTACT_EMAIL:
      if (!EMAIL_PATTERN.test(trimmed)) {
        throw invalid(definition, 'Enter a valid email address.');
      }
      return trimmed.toLowerCase();

    case SETTINGS_KEYS.BRAND_LOGO_KEY:
      if (!BRAND_KEY_PATTERN.test(trimmed)) {
        throw invalid(definition, 'A brand asset must live under the brand/ prefix.');
      }
      return trimmed;

    case SETTINGS_KEYS.SHORT_LINK_SLUG:
      if (!SLUG_PATTERN.test(trimmed)) {
        throw invalid(definition, 'Use 2–40 lowercase letters, numbers or hyphens.');
      }
      return trimmed;

    default:
      if (trimmed.length === 0) {
        throw invalid(definition, 'Enter a value.');
      }
      return trimmed;
  }
}

function validateNumber(definition: SettingDefinition, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(definition, 'Expected a number.');
  }
  if (!Number.isInteger(value)) {
    throw invalid(definition, 'Enter a whole number.');
  }

  const [min, max] = numericBounds(definition.key);
  if (value < min || value > max) {
    throw invalid(definition, `Enter a whole number between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Per-key bounds.
 *
 * `budget.warnThresholdPercent` stops at 99 on purpose: A-29 pairs a **soft warning**
 * with a **hard stop at 100%**, and a warning that fires at the same moment as the
 * stop is not a warning.
 */
function numericBounds(key: SettingsKey): readonly [number, number] {
  switch (key) {
    case SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY:
      return [0, 1000];
    case SETTINGS_KEYS.BUDGET_MONTHLY_GENERATIONS:
      return [0, 1_000_000];
    case SETTINGS_KEYS.BUDGET_WARN_THRESHOLD_PERCENT:
      return [1, 99];
    case SETTINGS_KEYS.PHOTOS_MAX_PER_CONSUMER:
      return [1, 50];
    case SETTINGS_KEYS.QUALITY_MIN_SCORE:
      return [0, 100];
    default:
      return [0, Number.MAX_SAFE_INTEGER];
  }
}

function validateJson(definition: SettingDefinition, value: unknown): unknown {
  if (definition.key === SETTINGS_KEYS.BRAND_STORE_ADDRESSES) {
    return validateStoreAddresses(definition, value);
  }
  if (value === null || typeof value !== 'object') {
    throw invalid(definition, 'Expected an object or a list.');
  }
  return value;
}

function validateStoreAddresses(definition: SettingDefinition, value: unknown): BrandAddress[] {
  if (!Array.isArray(value)) {
    throw invalid(definition, 'Expected a list of addresses.');
  }
  if (value.length > MAX_STORE_ADDRESSES) {
    throw invalid(definition, `Keep the list to ${MAX_STORE_ADDRESSES} addresses or fewer.`);
  }

  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalid(definition, `Address ${index + 1} is not an address.`);
    }
    const record = entry as Record<string, unknown>;
    const address: BrandAddress = {
      label: requiredField(definition, record.label, `Address ${index + 1} needs a label.`),
      address: requiredField(
        definition,
        record.address,
        `Address ${index + 1} needs a street address.`,
      ),
    };
    const city = optionalField(
      definition,
      record.city,
      `Address ${index + 1} has an invalid city.`,
    );
    if (city !== undefined) {
      address.city = city;
    }
    const phone = optionalField(
      definition,
      record.phone,
      `Address ${index + 1} has an invalid phone.`,
    );
    if (phone !== undefined) {
      address.phone = phone;
    }
    const mapUrl = optionalField(
      definition,
      record.mapUrl,
      `Address ${index + 1} has an invalid map link.`,
    );
    if (mapUrl !== undefined) {
      address.mapUrl = mapUrl;
    }
    return address;
  });
}

function requiredField(definition: SettingDefinition, value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid(definition, message);
  }
  if (value.length > MAX_ADDRESS_FIELD_LENGTH) {
    throw invalid(definition, message);
  }
  return value.trim();
}

function optionalField(
  definition: SettingDefinition,
  value: unknown,
  message: string,
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return requiredField(definition, value, message);
}

function invalid(definition: SettingDefinition, message: string): ValidationException {
  return new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
    message,
    // `settingKey` rather than `key`: the redactor drops anything named `key`
    // (redact.util.ts), and this one is a registry identifier, not a storage key.
    details: { settingKey: definition.key, valueType: definition.valueType },
  });
}
