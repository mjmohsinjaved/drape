import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { toDataURL } from 'qrcode';

import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { QrCodeResponseDto, ShortLinkResponseDto } from '../dto/short-link-response.dto';

import { SettingsService } from './settings.service';

/**
 * Rendering options for the in-store QR.
 *
 * `errorCorrectionLevel: 'M'` because the code goes on printed signage that will be
 * scanned from a metre away in shop lighting, and `margin: 2` because a QR with no
 * quiet zone is a QR that half the phones in the room will not see.
 */
const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  type: 'image/png',
  margin: 2,
  width: 512,
} as const;

/**
 * A-32 — the in-store QR code and the copyable Instagram-bio short link.
 *
 * Both are the same URL: `APP_WEB_URL` plus the `shortLink.slug` setting. Changing the
 * slug changes both at once, which is the point — a studio that reprints its signage
 * should not have to remember to update its bio too.
 */
@Injectable()
export class ShortLinkService {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /** `GET /settings/short-link` (A-32). */
  async getShortLink(): Promise<ShortLinkResponseDto> {
    const { slug, url } = await this.resolveTarget();
    const dto = new ShortLinkResponseDto();
    dto.slug = slug;
    dto.url = url;
    return dto;
  }

  /**
   * `GET /settings/qr` (A-32).
   *
   * Returns a `data:` URL rather than a binary stream so the response stays inside the
   * §2.3 envelope and the admin screen can render and print it without a second
   * authenticated request.
   */
  async getQrCode(): Promise<QrCodeResponseDto> {
    const { slug, url } = await this.resolveTarget();
    const dto = new QrCodeResponseDto();
    dto.slug = slug;
    dto.targetUrl = url;
    dto.dataUrl = await toDataURL(url, QR_OPTIONS);
    return dto;
  }

  private async resolveTarget(): Promise<{ slug: string; url: string }> {
    // `getOrThrow` because §7 marks APP_WEB_URL required: a QR code pointing at a
    // default nobody chose would be printed and put on a wall.
    const webUrl = this.config.getOrThrow<string>('APP_WEB_URL');
    const slug = (await this.settings.getString(SETTINGS_KEYS.SHORT_LINK_SLUG)) ?? 'drape';

    return { slug, url: `${webUrl.replace(/\/+$/, '')}/${slug}` };
  }
}
