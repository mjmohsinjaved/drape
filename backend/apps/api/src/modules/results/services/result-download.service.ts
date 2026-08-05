import { Injectable, Logger } from '@nestjs/common';

import { Locale, type ICurrentUser } from '@library/common';
import { ImageService, StorageService } from '@library/storage';

import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { ResultsService } from './results.service';

/** A watermarked render, ready to be streamed as an attachment. */
export interface WatermarkedRender {
  readonly bytes: Buffer;
  readonly contentType: string;
  /** Derived from the garment title snapshot, so the file is recognisable on disk. */
  readonly filename: string;
}

/** Keeps a title safe as a filename without turning it into gibberish. */
function toFilenameStem(title: string): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem.length === 0 ? 'render' : stem;
}

/**
 * **C-23 — the download watermark, applied at download time only.**
 *
 * §3.6 records the decision and the reason: stored renders stay clean, so history and
 * re-download stay cheap and the mark can be restyled without a backfill. The
 * consequence is that this is the *only* path that composites it, and that the stored
 * file must never be handed out directly — which is why the render's signed URL serves
 * the clean image for display and this route serves the marked one for keeping.
 *
 * The mark comes from the `brand/` asset when an admin has uploaded one (A-27) and
 * falls back to the packaged text mark otherwise. Direction follows her locale: §3.6's
 * "bottom-inline-end" is bottom-right in English and bottom-left in Urdu (D-10).
 */
@Injectable()
export class ResultDownloadService {
  private readonly logger = new Logger(ResultDownloadService.name);

  constructor(
    private readonly results: ResultsService,
    private readonly storage: StorageService,
    private readonly images: ImageService,
    private readonly settings: SettingsService,
  ) {}

  /** `GET /results/:resultId/download` — the watermarked PNG (C-23, §5.12). */
  async download(user: ICurrentUser, resultId: string): Promise<WatermarkedRender> {
    const result = await this.results.loadOwned(user.id, resultId);
    const clean = await this.storage.getBuffer(result.storageKey);

    const [mark, brandName] = await Promise.all([
      this.brandMark(),
      this.settings.getString(SETTINGS_KEYS.BRAND_NAME),
    ]);

    const bytes = await this.images.watermark(clean, {
      ...(mark === null ? {} : { mark }),
      text: brandName ?? 'Drape',
      direction: user.locale === Locale.UR ? 'rtl' : 'ltr',
    });

    return {
      bytes,
      contentType: 'image/png',
      filename: `${toFilenameStem(result.garmentTitleSnapshot)}-${result.id.slice(0, 8)}.png`,
    };
  }

  /**
   * The brand asset, or `null` for the packaged text mark.
   *
   * A missing or unreadable asset must never fail a download — she asked for her
   * render, not for the logo — so a failure here degrades to the text mark and logs.
   */
  private async brandMark(): Promise<Buffer | null> {
    const key = await this.settings.getString(SETTINGS_KEYS.BRAND_LOGO_KEY);
    if (key === null) {
      return null;
    }
    try {
      return await this.storage.getBuffer(key);
    } catch (error: unknown) {
      this.logger.warn(
        `The brand logo could not be read; falling back to the text watermark. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
