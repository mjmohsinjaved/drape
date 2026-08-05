import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ImageService, StorageKeys, StorageService } from '@library/storage';

import { TryOnResult } from '../entities/tryon-result.entity';

/** §3.3 — the history-grid thumbnail width. Generated on write, never on read (§3.6). */
export const RENDER_THUMBNAIL_WIDTH = 320;

/** A render that is on disk and ready to be recorded. */
export interface StoredRender {
  /** `renders/<userId>/<uuid>.png`, unwatermarked (§4.18, C-23). */
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
}

/**
 * Everything `tryon_results` needs, including the denormalised snapshots.
 *
 * The snapshots are **required**, not optional. §4.18: "the history list renders
 * exclusively from the snapshots — it does not join `garments`". A row written with a
 * `garmentId` but an empty title snapshot looks fine today and is a blank line in her
 * history the day the garment is hard-deleted.
 */
export interface PersistResultInput {
  readonly jobId: string;
  readonly userId: string;
  readonly garmentId: string | null;
  readonly personPhotoId: string | null;
  readonly cacheKey: string;
  readonly render: StoredRender;
  readonly isTestRender: boolean;

  readonly garmentTitleSnapshot: string;
  readonly garmentCategorySnapshot: string;
  readonly garmentPriceSnapshot: number | null;
  readonly garmentCurrencySnapshot: string;
  readonly personPhotoLabelSnapshot: string | null;
}

/**
 * **The write path into `tryon_results` — ARCHITECTURE §4.18, PRD C-24 … C-31.**
 *
 * Separated from `ResultsService` (which reads, lists and deletes) because this is the
 * surface `tryon` depends on, and a module that only needs to *record* a render should
 * not be handed the history query surface as well.
 *
 * ### Why the snapshots exist and why they are written here
 *
 * A render outlives everything it was made from. The photo is deleted (C-28), the
 * garment is unpublished, archived or removed (C-29), the job is pruned after 90 days
 * (C-27) — and her history is still supposed to read correctly. All four foreign keys
 * are `ON DELETE SET NULL` and the snapshot columns carry the meaning. Writing them is
 * therefore not an optimisation; it is the feature.
 *
 * ### Thumbnails on write, watermark on read
 *
 * §3.6: thumbnails are "generated on write, never on read", and the C-23 watermark is
 * composited at **download** time only. So the stored render is clean and the history
 * list is cheap — which is also what lets the watermark be restyled without a backfill.
 */
@Injectable()
export class ResultWriterService {
  private readonly logger = new Logger(ResultWriterService.name);

  constructor(
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
    private readonly storage: StorageService,
    private readonly images: ImageService,
  ) {}

  /**
   * Writes freshly generated PNG bytes into `userId`'s namespace, with a thumbnail.
   *
   * The key comes from `StorageKeys.render()` — §3.3 is the only place a key is
   * constructed, and `renders/<userId>/` is what makes account deletion a prefix
   * delete and signed URLs `sub`-scoped.
   */
  async storeRender(
    userId: string,
    png: Buffer,
    dimensions: { width: number; height: number },
  ): Promise<StoredRender> {
    const key = StorageKeys.render(userId);
    const stored = await this.storage.put(key, png, { contentType: 'image/png' });

    return {
      storageKey: stored.key,
      thumbnailKey: await this.writeThumbnail(png),
      width: dimensions.width,
      height: dimensions.height,
      byteSize: stored.size,
    };
  }

  /**
   * Gives an already-copied render (a §3.7 cache hit) its own thumbnail.
   *
   * The bytes are read back rather than passed in because the copy happened at the
   * storage layer, which is the cheap way to duplicate a render — one read to build a
   * 320px webp is still an order of magnitude less than a generation.
   */
  async thumbnailForStoredRender(storageKey: string): Promise<string | null> {
    try {
      return await this.writeThumbnail(await this.storage.getBuffer(storageKey));
    } catch (error: unknown) {
      this.logger.warn(
        `Could not build a thumbnail for a copied render; the list will fall back to the ` +
          `full image. ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** Appends the history row. */
  async persist(input: PersistResultInput): Promise<TryOnResult> {
    const result = this.results.create({
      jobId: input.jobId,
      userId: input.userId,
      garmentId: input.garmentId,
      personPhotoId: input.personPhotoId,
      storageKey: input.render.storageKey,
      thumbnailKey: input.render.thumbnailKey,
      cacheKey: input.cacheKey,
      garmentTitleSnapshot: input.garmentTitleSnapshot,
      garmentCategorySnapshot: input.garmentCategorySnapshot,
      garmentPriceSnapshot: input.garmentPriceSnapshot,
      garmentCurrencySnapshot: input.garmentCurrencySnapshot,
      personPhotoLabelSnapshot: input.personPhotoLabelSnapshot,
      isTestRender: input.isTestRender,
      width: input.render.width,
      height: input.render.height,
      byteSize: input.render.byteSize,
      // §9.3 — brand marketing use is a per-render explicit opt-in. Never defaulted on.
      marketingOptInAt: null,
    });

    return this.results.save(result);
  }

  private async writeThumbnail(png: Buffer): Promise<string | null> {
    try {
      const webp = await this.images.toWebpThumbnail(png, RENDER_THUMBNAIL_WIDTH, {
        fit: 'inside',
      });
      const key = StorageKeys.thumbnail('render', RENDER_THUMBNAIL_WIDTH);
      const stored = await this.storage.put(key, webp, { contentType: 'image/webp' });
      return stored.key;
    } catch (error: unknown) {
      // A missing thumbnail degrades the grid; a failed generation loses the render.
      // Never let the former cause the latter.
      this.logger.warn(
        `Thumbnail generation failed for a render. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
