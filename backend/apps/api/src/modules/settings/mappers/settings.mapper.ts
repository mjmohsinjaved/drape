import {
  SETTINGS_KEYS,
  type SettingDefinition,
  type SettingsKey,
} from '@api/shared/constants/settings-keys.constant';

import { BrandAddressDto, BrandSettingsResponseDto } from '../dto/brand-settings-response.dto';
import { SettingResponseDto } from '../dto/setting-response.dto';
import { PUBLIC_SETTING_DEFINITIONS } from '../validation/setting-value.validator';

import type { Setting } from '../entities/setting.entity';

/**
 * How one public setting becomes one field of {@link BrandSettingsResponseDto}.
 *
 * `sign` turns a storage key into a signed, expiring URL. Only `brand.logoKey` uses
 * it, and it is passed in rather than injected so this file stays a pure mapper.
 */
type BrandProjector = (
  target: BrandSettingsResponseDto,
  value: unknown,
  sign: (key: string) => string,
) => void;

/**
 * The projection table — **keyed by setting key, one entry per public key**.
 *
 * `toBrandSettingsResponse` walks `PUBLIC_SETTING_DEFINITIONS` (which is
 * `SETTINGS_REGISTRY.filter(isPublic)`) and looks each definition up here. It never
 * walks this table, and it never touches a value it did not find in the registry
 * marked public. That is what makes leaking a private key structurally impossible
 * rather than a matter of remembering: a private key is not in the input at all, and
 * a public key with no entry here throws instead of being silently dropped.
 */
const BRAND_PROJECTORS: Readonly<Partial<Record<SettingsKey, BrandProjector>>> = {
  [SETTINGS_KEYS.BRAND_NAME]: (target, value) => {
    target.name = asString(value) ?? 'Drape';
  },
  [SETTINGS_KEYS.BRAND_LOGO_KEY]: (target, value, sign) => {
    const key = asString(value);
    // The key itself never crosses the wire (§3.4, E-12) — only a signed URL does.
    target.logoUrl = key === null ? null : sign(key);
  },
  [SETTINGS_KEYS.BRAND_PRIMARY_COLOR]: (target, value) => {
    target.primaryColor = asString(value) ?? '#71202F';
  },
  [SETTINGS_KEYS.BRAND_WHATSAPP_NUMBER]: (target, value) => {
    target.whatsappNumber = asString(value);
  },
  [SETTINGS_KEYS.BRAND_INSTAGRAM_HANDLE]: (target, value) => {
    target.instagramHandle = asString(value);
  },
  [SETTINGS_KEYS.BRAND_CONTACT_EMAIL]: (target, value) => {
    target.contactEmail = asString(value);
  },
  [SETTINGS_KEYS.BRAND_STORE_ADDRESSES]: (target, value) => {
    target.storeAddresses = asAddresses(value);
  },
  [SETTINGS_KEYS.CATALOG_SHOW_PRICES_PUBLICLY]: (target, value) => {
    target.showPricesPublicly = value === true;
  },
  [SETTINGS_KEYS.SHARING_ENABLED]: (target, value) => {
    target.sharingEnabled = value === true;
  },
  [SETTINGS_KEYS.ENQUIRIES_ENABLED]: (target, value) => {
    target.enquiriesEnabled = value === true;
  },
  [SETTINGS_KEYS.SHORT_LINK_SLUG]: (target, value) => {
    target.shortLinkSlug = asString(value) ?? 'drape';
  },
};

/**
 * `GET /settings/brand` (A-27, A-30) — the public projection.
 *
 * @param values every resolved setting, public and private alike.
 * @param sign   turns a storage key into a signed download URL.
 */
export function toBrandSettingsResponse(
  values: ReadonlyMap<SettingsKey, unknown>,
  sign: (key: string) => string,
): BrandSettingsResponseDto {
  const dto = new BrandSettingsResponseDto();

  for (const definition of PUBLIC_SETTING_DEFINITIONS) {
    const project = BRAND_PROJECTORS[definition.key];
    if (project === undefined) {
      // A new public key landed in the registry with no projection. Failing loudly
      // beats shipping a brand response that silently omits it.
      throw new Error(
        `"${definition.key}" is marked isPublic in SETTINGS_REGISTRY but has no projection in ` +
          'settings.mapper.ts. Add one, or mark the key private.',
      );
    }
    project(dto, values.get(definition.key) ?? null, sign);
  }

  return dto;
}

/** Registry definition + resolved value → the admin `GET /settings` row. */
export function toSettingResponse(
  definition: SettingDefinition,
  value: unknown,
  row: Setting | undefined,
): SettingResponseDto {
  const dto = new SettingResponseDto();
  dto.key = definition.key;
  dto.value = value;
  dto.valueType = definition.valueType;
  dto.description = definition.description;
  // Read from the registry, not from the row: the registry is authoritative, so a
  // stale `isPublic` column can never widen what `GET /settings/brand` exposes.
  dto.isPublic = definition.isPublic;
  dto.requirement = definition.requirement;
  dto.updatedBy = row?.updatedBy ?? null;
  dto.updatedAt = row?.updatedAt ?? null;
  return dto;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asAddresses(value: unknown): BrandAddressDto[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): BrandAddressDto[] => {
    if (entry === null || typeof entry !== 'object') {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const label = asString(record.label);
    const address = asString(record.address);
    if (label === null || address === null) {
      return [];
    }
    const dto = new BrandAddressDto();
    dto.label = label;
    dto.address = address;
    const city = asString(record.city);
    if (city !== null) {
      dto.city = city;
    }
    const phone = asString(record.phone);
    if (phone !== null) {
      dto.phone = phone;
    }
    const mapUrl = asString(record.mapUrl);
    if (mapUrl !== null) {
      dto.mapUrl = mapUrl;
    }
    return [dto];
  });
}
