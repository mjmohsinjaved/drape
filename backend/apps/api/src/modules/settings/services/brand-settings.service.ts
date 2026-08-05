import { Injectable, Logger } from '@nestjs/common';

import { ErrorCode, ValidationException, type ICurrentUser } from '@library/common';
import { StorageService, keyPrefixSegment } from '@library/storage';

import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { BrandSettingsResponseDto } from '../dto/brand-settings-response.dto';
import { toBrandSettingsResponse } from '../mappers/settings.mapper';

import { SettingsService } from './settings.service';

import type { SetBrandLogoDto } from '../dto/brand-logo.dto';
import type { SettingResponseDto } from '../dto/setting-response.dto';

/** The only prefix a brand asset may live under (§3.3). */
const BRAND_PREFIX = 'brand';

/**
 * A-27 branding: the public projection, and the brand logo.
 *
 * Kept apart from `SettingsService` deliberately. `SettingsService` is the hot-path
 * config reader that W3–W7 depend on, and giving it a dependency on `@library/storage`
 * would drag the storage driver into every module that only wanted to know whether
 * sharing is switched on. This class is where "settings" meets "files"; that one is
 * where "settings" meets "everything else".
 */
@Injectable()
export class BrandSettingsService {
  private readonly logger = new Logger(BrandSettingsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * `GET /settings/brand` — the **public** projection (A-27, A-30, §5.4).
   *
   * The mapper walks `SETTINGS_REGISTRY.filter(isPublic)`, so a key that is not marked
   * public is not in the input to this response at all. `brand.logoKey` becomes a
   * signed, expiring URL; the storage key itself never crosses the wire (§3.4, E-12).
   */
  async getPublicBrand(): Promise<BrandSettingsResponseDto> {
    const values = await this.settings.values();
    return toBrandSettingsResponse(values, (key) => this.storage.signedUrl(key));
  }

  /**
   * `POST /settings/brand/logo` — finalise a brand-asset upload (§5.4).
   *
   * The bytes arrive through the §3.5 upload-ticket flow, not through this endpoint.
   * What happens here is the part that has to be authorised and audited: confirm the
   * object really exists under `brand/`, point `brand.logoKey` at it, and clean up the
   * one it replaced. A key that names an object which is not there sets nothing — that
   * is what stops a guessed key from repointing the logo at someone else's file.
   */
  async setLogo(dto: SetBrandLogoDto, actor: ICurrentUser): Promise<SettingResponseDto> {
    if (keyPrefixSegment(dto.key) !== BRAND_PREFIX) {
      throw new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
        message: 'A brand asset must live under the brand/ prefix.',
      });
    }

    const stored = await this.storage.head(dto.key);
    if (stored === null) {
      throw new ValidationException(ErrorCode.SETTINGS_VALUE_INVALID, {
        message: 'That upload could not be found. Start the upload again.',
      });
    }

    const previousKey = await this.settings.getString(SETTINGS_KEYS.BRAND_LOGO_KEY);

    const setting = await this.settings.setInternal(
      SETTINGS_KEYS.BRAND_LOGO_KEY,
      dto.key,
      actor,
      AUDIT_ACTIONS.BRAND_ASSET_UPLOADED,
    );

    if (previousKey !== null && previousKey !== dto.key) {
      // Best-effort: the setting already points at the new object, so a failed cleanup
      // leaves an orphan rather than a broken logo. Never fail the request for it.
      try {
        await this.storage.delete(previousKey);
      } catch {
        this.logger.warn('Failed to remove the superseded brand logo. It is now orphaned.');
      }
    }

    return setting;
  }
}
