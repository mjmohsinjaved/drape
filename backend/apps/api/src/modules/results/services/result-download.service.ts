import { Readable } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';

import archiver from 'archiver';

import { Locale, type ICurrentUser } from '@library/common';
import { ImageService, StorageService } from '@library/storage';

import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { ResultsService } from './results.service';

import type { TryOnResult } from '../entities/tryon-result.entity';

/** A watermarked render, ready to be streamed as an attachment. */
export interface WatermarkedRender {
  readonly bytes: Buffer;
  readonly contentType: string;
  /** Derived from the garment title snapshot, so the file is recognisable on disk. */
  readonly filename: string;
}

/** A zip of watermarked renders, produced as it is read rather than assembled first. */
export interface WatermarkedArchive {
  readonly stream: Readable;
  readonly contentType: string;
  readonly filename: string;
  /** How many renders the archive will contain. Exactly the number asked for. */
  readonly entryCount: number;
}

/** Everything the mark needs, resolved once and reused for every entry of an archive. */
interface MarkStyle {
  readonly mark: Buffer | null;
  readonly brandName: string;
  readonly direction: 'ltr' | 'rtl';
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
 *
 * ### One render or twenty-five, the mark is the same
 *
 * §5.12 has two download routes and they must not diverge: `GET
 * /results/:resultId/download` and `POST /results/download` both composite through
 * {@link ResultDownloadService.watermark}, so an archived copy is exactly what the
 * single download would have produced. A separate "batch" watermark path is how a
 * brand ends up with unmarked images in circulation.
 *
 * ### No audit row
 *
 * A-3 lists what the audit log covers: catalog changes, publishes, deletions, role
 * changes, quota changes, suspensions, moderation-queue views and settings changes. A
 * consumer reading her own renders is none of those, and neither download route emits
 * one. The account-level export (C-39) does — `DATA_EXPORT_REQUESTED`, in `retention`
 * — because that one leaves with everything.
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
    const style = await this.markStyle(user);
    const bytes = await this.watermark(result, style);

    return {
      bytes,
      contentType: 'image/png',
      filename: `${toFilenameStem(result.garmentTitleSnapshot)}-${result.id.slice(0, 8)}.png`,
    };
  }

  /**
   * `POST /results/download` — a zip of a selected set, watermarked (C-23, §5.12).
   *
   * ### Ownership first, bytes second
   *
   * Every id is resolved and checked **before** the archive exists, because once the
   * first byte of a `200` has left there is no status code left to refuse with.
   * `ResultsService.loadOwnedMany()` applies the predicate per item, so a selection
   * containing one foreign id fails whole — and fails as `RESULT_NOT_FOUND`, which is
   * the same answer a made-up id gets (§9.2: the response must not become an oracle
   * for whether somebody else's render exists).
   *
   * ### Nothing is buffered
   *
   * The archive is a stream from the first entry, and each entry is a `Readable` that
   * reads and watermarks nothing until `archiver` pulls on it. Peak memory for a
   * twenty-five render download is therefore **one** render, and the client receives
   * bytes while the second image is still being marked.
   *
   * Stored, not deflated: a PNG is already deflate-compressed, so method 8 would spend
   * CPU per image to save nothing. It is a real ZIP either way — every entry carries
   * its CRC-32 and any unzip tool opens it.
   *
   * ### A failure mid-stream
   *
   * The only one left after the ownership pass is a stored object that has gone
   * missing. `archiver` raises it on the stream, the response aborts, and the client
   * sees a truncated download rather than an archive that unpacks to a lie. It is
   * logged here because nothing downstream is in a position to report it.
   */
  async downloadMany(
    user: ICurrentUser,
    resultIds: readonly string[],
  ): Promise<WatermarkedArchive> {
    const rows = await this.results.loadOwnedMany(user.id, resultIds);
    const style = await this.markStyle(user);

    const archive = archiver('zip', { store: true });

    archive.on('warning', (error: Error) => {
      this.logger.warn(`The renders archive reported a warning: ${error.message}`);
    });
    archive.on('error', (error: Error) => {
      this.logger.error(`The renders archive failed mid-stream: ${error.message}`);
    });

    const used = new Set<string>();
    for (const row of rows) {
      archive.append(Readable.from(this.markedBytes(row, style)), {
        name: this.entryName(row, used),
        date: row.createdAt,
      });
    }

    // Deliberately not awaited: `finalize()` settles once the last entry has been
    // written, which cannot happen until the caller starts reading the stream.
    // Awaiting it here would deadlock the request against its own response.
    void archive.finalize().catch((error: unknown) => {
      this.logger.error(
        `The renders archive could not be finalised. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return {
      stream: archive,
      contentType: 'application/zip',
      filename: `${toFilenameStem(style.brandName)}-renders-${rows.length}.zip`,
      entryCount: rows.length,
    };
  }

  /**
   * The bytes of one entry, produced when `archiver` asks for them and not before.
   *
   * An async generator rather than a buffer, so the queue holds a stream object per
   * entry instead of a decoded PNG per entry.
   */
  private async *markedBytes(result: TryOnResult, style: MarkStyle): AsyncGenerator<Buffer> {
    yield await this.watermark(result, style);
  }

  /** C-23, in one place. Both §5.12 download routes composite the mark through here. */
  private async watermark(result: TryOnResult, style: MarkStyle): Promise<Buffer> {
    const clean = await this.storage.getBuffer(result.storageKey);

    return this.images.watermark(clean, {
      ...(style.mark === null ? {} : { mark: style.mark }),
      text: style.brandName,
      direction: style.direction,
    });
  }

  /** A unique path inside the archive. Two renders of one piece must not overwrite each other. */
  private entryName(result: TryOnResult, used: Set<string>): string {
    const base = `${toFilenameStem(result.garmentTitleSnapshot)}-${result.id.slice(0, 8)}`;

    let candidate = `${base}.png`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}.png`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  }

  /** The brand asset, the brand name and the D-10 direction — read once per request. */
  private async markStyle(user: ICurrentUser): Promise<MarkStyle> {
    const [mark, brandName] = await Promise.all([
      this.brandMark(),
      this.settings.getString(SETTINGS_KEYS.BRAND_NAME),
    ]);

    return {
      mark,
      brandName: brandName ?? 'Drape',
      direction: user.locale === Locale.UR ? 'rtl' : 'ltr',
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
