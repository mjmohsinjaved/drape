/**
 * The `settings` module's public surface.
 *
 * `SettingsService` is the one every other module wants:
 *
 * ```typescript
 * const monthly = await this.settings.getNumber(SETTINGS_KEYS.QUOTA_DEFAULT_MONTHLY);
 * const gateOnEmail = await this.settings.getBoolean(SETTINGS_KEYS.QUOTA_REQUIRE_EMAIL_VERIFICATION);
 * ```
 *
 * The key constants themselves live in `@api/shared/constants/settings-keys.constant`
 * — that registry is authoritative and is not re-exported from here, so there is
 * exactly one import path for a key.
 */
export { SettingsModule } from './settings.module';
export { SettingsService } from './services/settings.service';
export { PREVIEW_MODE_TTL_MS, PreviewModeService } from './services/preview-mode.service';
export { BrandSettingsService } from './services/brand-settings.service';
export { ShortLinkService } from './services/short-link.service';
export { BrandAddressDto, BrandSettingsResponseDto } from './dto/brand-settings-response.dto';
export { BudgetPolicyResponseDto, SettingResponseDto } from './dto/setting-response.dto';
export { PreviewModeResponseDto, SetPreviewModeDto } from './dto/preview-mode.dto';
export { QrCodeResponseDto, ShortLinkResponseDto } from './dto/short-link-response.dto';
export { SettingChangeDto, UpdateSettingsDto } from './dto/update-settings.dto';
export {
  PUBLIC_SETTING_DEFINITIONS,
  definitionFor,
  validateSettingValue,
  type BrandAddress,
} from './validation/setting-value.validator';
