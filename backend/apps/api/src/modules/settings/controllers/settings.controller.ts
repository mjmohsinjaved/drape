import { Body, Controller, Get, Patch, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ApiStandardResponses,
  CurrentUser,
  Public,
  ResponseMessage,
  Role,
  Roles,
  type ICurrentUser,
} from '@library/common';

import { SetBrandLogoDto } from '../dto/brand-logo.dto';
import { BrandSettingsResponseDto } from '../dto/brand-settings-response.dto';
import { PreviewModeResponseDto, SetPreviewModeDto } from '../dto/preview-mode.dto';
import { SettingResponseDto } from '../dto/setting-response.dto';
import { QrCodeResponseDto, ShortLinkResponseDto } from '../dto/short-link-response.dto';
import { UpdateSettingsDto } from '../dto/update-settings.dto';
import { BrandSettingsService } from '../services/brand-settings.service';
import { PreviewModeService } from '../services/preview-mode.service';
import { SettingsService } from '../services/settings.service';
import { ShortLinkService } from '../services/short-link.service';

/**
 * ARCHITECTURE §5.4 — platform settings.
 *
 * One route is public and every other one is `ADMIN`. `GET /settings/brand` has to be
 * public: the web app themes itself from it before a visitor has a session, and the
 * signed-out catalog needs the A-30 toggles to know whether to render prices. It
 * returns the registry-filtered public projection and nothing else — see
 * `settings.mapper.ts` for why a private key cannot reach it.
 */
@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly brand: BrandSettingsService,
    private readonly shortLinks: ShortLinkService,
    private readonly preview: PreviewModeService,
  ) {}

  @Get('brand')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ResponseMessage('Brand settings retrieved successfully')
  @ApiOperation({ summary: 'Public brand configuration the web app themes from (A-27, A-30)' })
  @ApiOkResponse({ type: BrandSettingsResponseDto })
  @ApiStandardResponses({ auth: false })
  async getBrand(): Promise<BrandSettingsResponseDto> {
    return this.brand.getPublicBrand();
  }

  @Get()
  @Roles(Role.ADMIN)
  @ResponseMessage('Settings retrieved successfully')
  @ApiOperation({ summary: 'Full settings map (A-27 … A-30)' })
  @ApiOkResponse({ type: [SettingResponseDto] })
  @ApiStandardResponses()
  async findAll(): Promise<SettingResponseDto[]> {
    return this.settings.findAll();
  }

  @Patch()
  @Roles(Role.ADMIN)
  @ResponseMessage('Settings updated successfully')
  @ApiOperation({
    summary:
      'Update one or more keys — brand basics (A-27), quota and email verification ' +
      '(A-28), the monthly budget and its warning threshold (A-29), and the toggles (A-30)',
  })
  @ApiOkResponse({ type: [SettingResponseDto] })
  @ApiStandardResponses({ conflict: true })
  async update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<SettingResponseDto[]> {
    return this.settings.update(dto, actor);
  }

  @Post('brand/logo')
  @Roles(Role.ADMIN)
  @ResponseMessage('Brand logo updated successfully')
  @ApiOperation({ summary: 'Finalise a brand-asset upload and set brand.logoKey (A-27)' })
  @ApiOkResponse({ type: SettingResponseDto })
  @ApiStandardResponses({ unprocessable: true })
  async setLogo(
    @Body() dto: SetBrandLogoDto,
    @CurrentUser() actor: ICurrentUser,
  ): Promise<SettingResponseDto> {
    return this.brand.setLogo(dto, actor);
  }

  @Get('qr')
  @Roles(Role.ADMIN)
  @ResponseMessage('QR code generated successfully')
  @ApiOperation({ summary: 'QR code for in-store signage, as a PNG data URL (A-32)' })
  @ApiOkResponse({ type: QrCodeResponseDto })
  @ApiStandardResponses()
  async getQrCode(): Promise<QrCodeResponseDto> {
    return this.shortLinks.getQrCode();
  }

  @Get('short-link')
  @Roles(Role.ADMIN)
  @ResponseMessage('Short link retrieved successfully')
  @ApiOperation({ summary: 'The copyable Instagram-bio short link (A-32)' })
  @ApiOkResponse({ type: ShortLinkResponseDto })
  @ApiStandardResponses()
  async getShortLink(): Promise<ShortLinkResponseDto> {
    return this.shortLinks.getShortLink();
  }

  @Get('preview')
  @Roles(Role.ADMIN)
  @ResponseMessage('Preview mode state retrieved successfully')
  @ApiOperation({ summary: 'Whether this admin is in preview mode (A-31)' })
  @ApiOkResponse({ type: PreviewModeResponseDto })
  @ApiStandardResponses()
  getPreviewMode(@CurrentUser('id') adminId: string): PreviewModeResponseDto {
    return this.preview.getState(adminId);
  }

  @Put('preview')
  @Roles(Role.ADMIN)
  @ResponseMessage('Preview mode updated successfully')
  @ApiOperation({
    summary: 'View the consumer experience without spending generations (A-31)',
    description:
      'Scoped to the calling admin and held for the session, not stored as a setting: a ' +
      'platform-wide flag would change what consumers see. W3 honours it in TryOnService.',
  })
  @ApiOkResponse({ type: PreviewModeResponseDto })
  @ApiStandardResponses()
  setPreviewMode(
    @Body() dto: SetPreviewModeDto,
    @CurrentUser('id') adminId: string,
  ): PreviewModeResponseDto {
    return this.preview.setPreviewMode(adminId, dto.enabled);
  }
}
