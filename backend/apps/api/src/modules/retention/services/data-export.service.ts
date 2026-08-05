import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  ErrorCode,
  MILLISECONDS_PER_HOUR,
  NotFoundException,
  slugify,
  type ICurrentUser,
} from '@library/common';
import {
  EXPORT_CONTENT_TYPE,
  exportIdFromKey,
  StorageKeys,
  StoragePrefixes,
  StorageService,
} from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import {
  EXPORT_RETENTION_HOURS,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_RENDERS,
  MAX_LIVE_EXPORTS_PER_CONSUMER,
} from '../constants/retention.constants';
import { DataExportResponseDto, DataExportStatus } from '../dto/data-export-response.dto';
import { buildZipArchive, type ZipEntry } from '../utils/zip-archive';

/** How long a filename fragment derived from a garment title may be. */
const MAX_RENDER_FILENAME_STEM = 60;

/** The manifest written at the root of every archive. */
interface ExportManifest {
  readonly exportedAt: string;
  readonly renderCount: number;
  readonly shortlistCount: number;
  readonly truncated: boolean;
  readonly note: string;
}

/**
 * **C-39 — "data export of her own shortlists and renders as a downloadable archive".**
 *
 * ### It is a real ZIP
 *
 * Written by {@link buildZipArchive}: local file headers, a central directory, an EOCD
 * record and a CRC-32 per entry, per PKWARE APPNOTE. `unzip` opens it, Explorer opens
 * it, Python's `zipfile` opens it. `archiver` is not a dependency of this project and
 * was not added for it — see that module's own comment for the reasoning, which is not
 * "we could not be bothered" but "PNG is already compressed and the format fits in one
 * file".
 *
 * ### What is in it
 *
 * ```
 * manifest.json          — when, how many, and whether it was truncated
 * shortlist.json         — every verdict, with reason and note (C-21, C-32)
 * renders/<title>-<id>.png
 * TRUNCATED.txt          — only when a cap was hit
 * ```
 *
 * Renders are named from `garmentTitleSnapshot` rather than from the garment table, for
 * the C-29 reason: the snapshot is what survives, and an export taken after the studio
 * archived a dress should still tell her which dress it was.
 *
 * ### Bounded, and honest when the bound bites
 *
 * The archive is assembled in memory, so "how large can it be" needs an answer that does
 * not depend on how long she has had an account. Two caps —
 * {@link MAX_EXPORT_RENDERS} and {@link MAX_EXPORT_BYTES} — and when either bites, the
 * response says `truncated: true` **and** a `TRUNCATED.txt` goes inside the file. A
 * partial archive that does not say it is partial is worse than a refusal: she opens it
 * next year, finds forty renders, and concludes the other three hundred were never
 * there.
 *
 * ### There is no export table
 *
 * The object in `exports/<userId>/<uuid>.zip` **is** the record. Status is derived from
 * whether it exists, which means there is no state to reconcile, nothing to clean up
 * when a row and an object disagree, and no second place her data is catalogued. The
 * key is composed from her session's `userId`, so `GET /me/export/:exportId` can only
 * ever address her own prefix.
 *
 * ### An archive expires, and the bytes expire with it
 *
 * The consequence of having no table is that nothing *iterates* archives, and for a while
 * nothing collected them either: `findExport` reported `EXPIRED` and withheld the URL
 * after {@link EXPORT_RETENTION_HOURS}, while the object stayed on disk indefinitely — a
 * status the response told the truth about and the store did not.
 *
 * Two things close it, and both are needed. `OrphanSweepService` walks `exports/**` on the
 * hourly retention cron and deletes anything past its retention window with a
 * `DeletionSubject.EXPORT_ARCHIVE` row in `deletion_log`; and
 * {@link enforceLiveExportCap} bounds how many can exist at once, because a sweep bounds
 * how long an archive lives and only a cap bounds how many there are.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    @InjectRepository(TryOnResult)
    private readonly renders: Repository<TryOnResult>,
    @InjectRepository(ShortlistItem)
    private readonly shortlist: Repository<ShortlistItem>,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  /** `POST /me/export` (C-39, §5.2). */
  async createExport(user: ICurrentUser, now: Date = new Date()): Promise<DataExportResponseDto> {
    const [renders, verdicts] = await Promise.all([
      this.renders.find({
        where: { userId: user.id },
        order: { createdAt: 'DESC' },
        take: MAX_EXPORT_RENDERS + 1,
      }),
      this.shortlist.find({ where: { userId: user.id }, order: { rank: 'ASC' } }),
    ]);

    const overRenderCap = renders.length > MAX_EXPORT_RENDERS;
    const selected = renders.slice(0, MAX_EXPORT_RENDERS);

    const entries: ZipEntry[] = [];
    let bytes = 0;
    let included = 0;
    let overByteCap = false;

    for (const render of selected) {
      let data: Buffer;
      try {
        data = await this.storage.getBuffer(render.storageKey);
      } catch (error: unknown) {
        // A render whose file is missing must not fail her whole export. It is logged,
        // skipped, and the manifest's count reflects what is actually in the archive.
        this.logger.warn(
          `A render was skipped from an export because its object could not be read: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      if (bytes + data.byteLength > MAX_EXPORT_BYTES) {
        overByteCap = true;
        break;
      }

      entries.push({
        name: `renders/${renderFilenameStem(render.garmentTitleSnapshot)}-${render.id}.png`,
        data,
        modifiedAt: render.createdAt,
      });
      bytes += data.byteLength;
      included += 1;
    }

    const truncated = overRenderCap || overByteCap;

    entries.unshift({
      name: 'shortlist.json',
      data: Buffer.from(JSON.stringify(this.shortlistDocument(verdicts), null, 2), 'utf8'),
      modifiedAt: now,
    });

    const manifest: ExportManifest = {
      exportedAt: now.toISOString(),
      renderCount: included,
      shortlistCount: verdicts.length,
      truncated,
      note:
        'This archive contains your own shortlists and renders. Renders are indicative ' +
        'shortlisting images, not photographs of the garment on you.',
    };
    entries.unshift({
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      modifiedAt: now,
    });

    if (truncated) {
      entries.push({
        name: 'TRUNCATED.txt',
        data: Buffer.from(
          `This export contains ${included} of your renders.\n` +
            `An archive is limited to ${MAX_EXPORT_RENDERS} renders and ` +
            `${Math.round(MAX_EXPORT_BYTES / (1024 * 1024))} MB.\n` +
            'Request another export to receive the rest.\n',
          'utf8',
        ),
        modifiedAt: now,
      });
    }

    const archive = buildZipArchive(entries);
    const key = StorageKeys.dataExport(user.id);
    await this.storage.put(key, archive, { contentType: EXPORT_CONTENT_TYPE });

    const exportId = exportIdFromKey(key);
    if (exportId === null) {
      // Unreachable unless the key builder and its own reader disagree, which is a
      // defect worth failing loudly on rather than returning an id nobody can use.
      throw new Error(`The export key "${key}" does not match the layout its reader expects.`);
    }

    await this.enforceLiveExportCap(user.id, key);

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.DATA_EXPORT_REQUESTED,
        targetType: AUDIT_TARGET_TYPES.USER,
        actorId: user.id,
        actorRole: user.role,
        targetId: user.id,
        // Counts and a size. Never the key, never a title, never a URL (E-12).
        metadata: {
          renderCount: included,
          shortlistCount: verdicts.length,
          byteSize: archive.byteLength,
          truncated,
        },
      }),
    );

    return this.present(user, exportId, archive.byteLength, now, {
      renderCount: included,
      shortlistCount: verdicts.length,
      truncated,
    });
  }

  /**
   * `GET /me/export/:exportId` (C-39, §5.2).
   *
   * The key is rebuilt from **her session's** id and the validated uuid, so an id
   * belonging to another account resolves to an object inside her own prefix that does
   * not exist — a 404, indistinguishable from an id that never existed (S-9). There is
   * no ownership check here because there is no way to express a cross-account read.
   */
  async findExport(
    user: ICurrentUser,
    exportId: string,
    now: Date = new Date(),
  ): Promise<DataExportResponseDto> {
    const key = StorageKeys.dataExportFor(user.id, exportId);
    const stored = await this.storage.head(key);

    if (stored === null) {
      throw new NotFoundException(ErrorCode.EXPORT_NOT_READY, { details: { exportId } });
    }

    const createdAt = stored.lastModified;
    const expiresAt = new Date(
      createdAt.getTime() + EXPORT_RETENTION_HOURS * MILLISECONDS_PER_HOUR,
    );

    if (expiresAt <= now) {
      const dto = new DataExportResponseDto();
      dto.exportId = exportId;
      dto.status = DataExportStatus.EXPIRED;
      dto.downloadUrl = null;
      dto.byteSize = stored.byteSize;
      dto.renderCount = 0;
      dto.shortlistCount = 0;
      dto.truncated = false;
      dto.createdAt = createdAt;
      dto.expiresAt = expiresAt;
      return dto;
    }

    // The counts live in the manifest inside the archive, which is where they belong —
    // they travel with the file rather than needing a table to survive. This route
    // reports the archive's existence and its size; opening it is the download.
    return this.present(user, exportId, stored.byteSize, createdAt, {
      renderCount: 0,
      shortlistCount: 0,
      truncated: false,
    });
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Keeps at most {@link MAX_LIVE_EXPORTS_PER_CONSUMER} archives in her prefix, newest first.
   *
   * `POST /me/export` used to mint an archive per call with no cap and nothing to collect
   * them: eleven presses of the button left eleven live archives, each holding up to five
   * hundred full-resolution renders of her body, each readable for
   * {@link EXPORT_RETENTION_HOURS}. The orphan sweep now expires them on age, but a cap
   * that only takes effect on the next cron run is not a cap — the peak is what matters,
   * and the peak is here.
   *
   * Applied **after** the write, so the archive she just asked for is never the one
   * evicted, and so a failure here cannot cost her the export. `newKey` is excluded
   * explicitly rather than relying on its mtime: two archives written inside the same
   * clock tick would otherwise be ordered arbitrarily.
   *
   * Never throws. Her export succeeded; an eviction that did not is a bounded amount of
   * extra storage that the sweep will take within {@link EXPORT_RETENTION_HOURS}, and it
   * is not a reason to fail a request that has already done what she asked.
   */
  private async enforceLiveExportCap(userId: string, newKey: string): Promise<void> {
    try {
      const archives = await this.storage.list(StoragePrefixes.exportsOfUser(userId));

      const evictable = archives
        .filter((object) => object.key !== newKey)
        .sort((left, right) => right.lastModified.getTime() - left.lastModified.getTime())
        .slice(MAX_LIVE_EXPORTS_PER_CONSUMER - 1);

      for (const object of evictable) {
        await this.storage.delete(object.key);
      }

      if (evictable.length > 0) {
        this.logger.log(
          `Removed ${evictable.length} superseded export archive(s); a consumer holds at most ` +
            `${MAX_LIVE_EXPORTS_PER_CONSUMER} at a time (C-39, §9.3).`,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        'Superseded export archives could not be evicted; the retention sweep will collect ' +
          `them within ${EXPORT_RETENTION_HOURS} hours. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private present(
    user: ICurrentUser,
    exportId: string,
    byteSize: number,
    createdAt: Date,
    counts: { renderCount: number; shortlistCount: number; truncated: boolean },
  ): DataExportResponseDto {
    const key = StorageKeys.dataExportFor(user.id, exportId);

    const dto = new DataExportResponseDto();
    dto.exportId = exportId;
    dto.status = DataExportStatus.READY;
    // Scoped to her own id (§3.4). A token issued without a subject would be a token
    // anybody could redeem, and this archive is her whole history.
    dto.downloadUrl = this.storage.signedUrl(key, user.id);
    dto.byteSize = byteSize;
    dto.renderCount = counts.renderCount;
    dto.shortlistCount = counts.shortlistCount;
    dto.truncated = counts.truncated;
    dto.createdAt = createdAt;
    dto.expiresAt = new Date(createdAt.getTime() + EXPORT_RETENTION_HOURS * MILLISECONDS_PER_HOUR);
    return dto;
  }

  /**
   * Her shortlist as JSON.
   *
   * Includes `NOT_FOR_ME` rows. They are hers, §4.20 retains them, and an export that
   * quietly excluded the things she rejected would be an export of the flattering half
   * of her data.
   */
  private shortlistDocument(items: readonly ShortlistItem[]): Record<string, unknown>[] {
    return items.map((item) => ({
      verdict: item.verdict,
      rejectReason: item.rejectReason,
      note: item.note,
      rank: item.rank,
      verdictAt: item.verdictAt.toISOString(),
      garmentId: item.garmentId,
    }));
  }
}

/** A filename-safe fragment of a garment title. Never a path — `zip-archive` re-checks. */
function renderFilenameStem(title: string): string {
  return slugify(title, MAX_RENDER_FILENAME_STEM) || 'render';
}
