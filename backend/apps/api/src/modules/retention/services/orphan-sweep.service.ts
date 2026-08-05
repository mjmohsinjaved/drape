import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { MILLISECONDS_PER_HOUR, sha256Hex } from '@library/common';
import {
  parseOwnedKey,
  StoragePrefixes,
  StorageService,
  type OwnedKeyNamespace,
  type ParsedOwnedKey,
  type StoredObject,
} from '@library/storage';

import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';

import {
  EXPORT_RETENTION_HOURS,
  ORPHAN_MIN_AGE_HOURS,
  ORPHAN_SWEEP_DELETE_LIMIT,
  ORPHAN_SWEEP_LIST_LIMIT,
  TEMP_SWEEP_LIMIT,
} from '../constants/retention.constants';
import { DeletionLogEntry } from '../entities/deletion-log-entry.entity';
import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

/** What one namespace's sweep accomplished. */
export interface NamespaceSweepReport {
  /** Objects listed and old enough to be candidates. */
  readonly examined: number;
  readonly deleted: number;
  readonly bytesReclaimed: number;
  /** True when the run stopped at {@link ORPHAN_SWEEP_DELETE_LIMIT} with work still to do. */
  readonly bounded: boolean;
}

/** What one whole sweep run accomplished. */
export interface OrphanSweepReport {
  readonly personPhotos: NamespaceSweepReport;
  readonly renders: NamespaceSweepReport;
  readonly exports: NamespaceSweepReport;
  /** `<root>/.tmp` files removed (§3.2 requirement 4). */
  readonly temporaryFilesDeleted: number;
  /** True when the run stopped early because the process is shutting down. */
  readonly cancelled: boolean;
}

const EMPTY_NAMESPACE: NamespaceSweepReport = {
  examined: 0,
  deleted: 0,
  bytesReclaimed: 0,
  bounded: false,
};

const EMPTY_REPORT: OrphanSweepReport = {
  personPhotos: EMPTY_NAMESPACE,
  renders: EMPTY_NAMESPACE,
  exports: EMPTY_NAMESPACE,
  temporaryFilesDeleted: 0,
  cancelled: false,
};

/** The keep set for a namespace with no owning table — `exports/**`. */
const NO_LIVE_KEYS: ReadonlySet<string> = new Set<string>();

/** The `deletion_log.subjectType` each namespace's orphans are recorded under. */
const SUBJECT_BY_NAMESPACE: Readonly<Record<OwnedKeyNamespace, DeletionSubject>> = {
  'person-photos': DeletionSubject.PERSON_PHOTO,
  renders: DeletionSubject.TRYON_RESULT,
  exports: DeletionSubject.EXPORT_ARCHIVE,
};

/**
 * **ARCHITECTURE §3.5 step 4 and §3.2 requirement 4 — the sweep three other files were
 * already relying on.**
 *
 * > §3.5 step 4: "an object with no owning row after 6 hours is swept by the retention cron"
 * > §3.2 requirement 4: "`.tmp` swept of files older than 6 hours by the retention cron"
 *
 * ### The leak this closes
 *
 * A consumer redeems an upload ticket. The bytes land at
 * `person-photos/<her id>/<uuid>.jpg`, EXIF stripped, and then she never calls `POST
 * /person-photos` — the connection drops, she closes the tab, the app is killed. There is
 * now a photograph of her on disk and **no row anywhere names it**.
 *
 * Every mechanism §9.3 promises operates on rows, so every one of them misses it:
 *
 * | Mechanism | Why it cannot see the object |
 * | --- | --- |
 * | `PurgeService` | iterates `person_photos`; no row means no `purgeAfter`, so it never expires |
 * | `GET /me/data` (C-37) | projects rows, so she cannot see it — and therefore cannot delete it |
 * | `deletion_log` | nothing was ever deleted, so nothing was ever recorded |
 * | `DELETE /me` (C-38) | *does* catch it, via `deletePrefix` — but only if she deletes her account |
 *
 * "Person photos are deleted 30 days after last account activity" is simply false for
 * that file. It is false forever. Three separate files — `results.service.ts`,
 * `garment-images.service.ts` and `files/services/upload-ticket.service.ts` — say in a
 * comment that this sweep will collect their orphans, and until now none of them was
 * right.
 *
 * The same shape covers a render whose file delete failed after its row was soft-deleted,
 * and `<root>/.tmp/<uuid>` files from aborted uploads — full or partial photographs
 * sitting outside any key namespace at all.
 *
 * ### C-27 is not weakened by any of this
 *
 * > C-27: "Renders persist for the life of the account. They are **not** subject to a
 * > time-based purge."
 *
 * This class reads `tryon_results` and could not do its job otherwise — but it never
 * deletes on the strength of a row's age, and it never deletes an object a row names. The
 * predicate is the exact inverse: *no row names this object*. A render with a live row is
 * kept; a render with a **soft-deleted** row is kept, because `withDeleted` puts it in the
 * keep set; a render written seconds ago is kept, because it is younger than
 * {@link ORPHAN_MIN_AGE_HOURS}. All three are asserted in the spec beside this file.
 *
 * `PurgeService` — the class that *does* delete on age — still cannot reach
 * `tryon_results` at all. That separation is unchanged and is what C-27 actually rests on.
 *
 * ### Why the keep set includes soft-deleted rows, and `tryon_cache`
 *
 * A soft-deleted `tryon_results` row is a render the consumer deleted (C-31) whose file
 * `ResultsService.remove` also deleted. If that file delete failed the object is a genuine
 * orphan — but the row still names it, and a sweep that ignored soft-deleted rows would
 * race the *successful* path: soft-delete commits, the object delete is a fraction of a
 * second behind it, and a concurrent sweep sees an object no live row names. Including
 * soft-deleted rows removes the race entirely, at the cost of leaving a genuinely failed
 * delete on disk until the account is deleted. That is the right trade: one is a leak that
 * account deletion still catches, the other is deleting a file out from under a request in
 * flight.
 *
 * `tryon_cache.storageKey` is a second keep source for `renders/**` for the same reason in
 * a different direction: §3.7 makes the canonical cached copy the requesting consumer's own
 * render, so a cache row pointing at a key is a live reference to it. Every such key should
 * also have a `tryon_results` row — this is belt and braces, and it is cheap.
 *
 * ### Bounded, cancellable, non-overlapping
 *
 * One run at a time ({@link running}); at most {@link ORPHAN_SWEEP_LIST_LIMIT} objects
 * examined and {@link ORPHAN_SWEEP_DELETE_LIMIT} deleted per namespace per run; stops
 * between objects on shutdown. A large store cannot stall the scheduler and a run
 * interrupted halfway has deleted whole objects, each with its own `deletion_log` row.
 */
@Injectable()
export class OrphanSweepService {
  private readonly logger = new Logger(OrphanSweepService.name);

  private running = false;
  private cancelled = false;

  constructor(
    @InjectRepository(PersonPhoto)
    private readonly photos: Repository<PersonPhoto>,
    @InjectRepository(TryOnResult)
    private readonly renders: Repository<TryOnResult>,
    @InjectRepository(TryOnCache)
    private readonly cache: Repository<TryOnCache>,
    @InjectRepository(DeletionLogEntry)
    private readonly deletions: Repository<DeletionLogEntry>,
    private readonly storage: StorageService,
  ) {}

  /** True while a run is in flight. The scheduler asks before starting another. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Stops the current run between objects. Called from the processor's shutdown hook. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * One sweep pass over all three namespaces plus `.tmp`.
   *
   * Throws on failure rather than swallowing, for the same reason `PurgeService` does: the
   * caller is the thing that knows an operator needs to hear about it (E-14), and a sweep
   * that silently reported nothing would make a broken sweep indistinguishable from a
   * clean store.
   */
  async sweepOnce(now: Date = new Date()): Promise<OrphanSweepReport> {
    if (this.running) {
      this.logger.debug('An orphan sweep is already in flight; this tick does nothing.');
      return EMPTY_REPORT;
    }

    this.running = true;
    this.cancelled = false;

    try {
      const orphanCutoff = new Date(now.getTime() - ORPHAN_MIN_AGE_HOURS * MILLISECONDS_PER_HOUR);
      const exportCutoff = new Date(now.getTime() - EXPORT_RETENTION_HOURS * MILLISECONDS_PER_HOUR);

      const personPhotos = await this.sweepNamespace(
        'person-photos',
        StoragePrefixes.allPersonPhotos(),
        orphanCutoff,
        now,
        (keys) => this.livePhotoKeys(keys),
      );

      const renders = this.cancelled
        ? EMPTY_NAMESPACE
        : await this.sweepNamespace(
            'renders',
            StoragePrefixes.allRenders(),
            orphanCutoff,
            now,
            (keys) => this.liveRenderKeys(keys),
          );

      // An archive has no owning row by design — `DataExportService` makes the object
      // itself the record — so "orphan" is not the predicate here. Age is: §4.31's
      // EXPORT_RETENTION_HOURS is the whole of an archive's life, and `findExport`
      // already reports one older than that as EXPIRED and withholds the URL. This is
      // what makes that report true of the bytes as well as of the response.
      const exports = this.cancelled
        ? EMPTY_NAMESPACE
        : await this.sweepNamespace(
            'exports',
            StoragePrefixes.allExports(),
            exportCutoff,
            now,
            // No keep set: there is no table to anti-join against, which is the point.
            () => Promise.resolve(NO_LIVE_KEYS),
          );

      const temporaryFilesDeleted = this.cancelled
        ? 0
        : await this.storage.sweepTemporaryFiles(orphanCutoff, TEMP_SWEEP_LIMIT);

      const report: OrphanSweepReport = {
        personPhotos,
        renders,
        exports,
        temporaryFilesDeleted,
        cancelled: this.cancelled,
      };

      this.log(report);
      return report;
    } finally {
      this.running = false;
    }
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Lists one namespace, subtracts everything a row still names, and removes the remainder.
   *
   * The age filter is applied **before** the anti-join, so the database is asked about the
   * few objects that could possibly be orphans rather than about every object in the store.
   */
  private async sweepNamespace(
    namespace: OwnedKeyNamespace,
    prefix: string,
    cutoff: Date,
    now: Date,
    liveKeys: (candidates: readonly string[]) => Promise<ReadonlySet<string>>,
  ): Promise<NamespaceSweepReport> {
    const listed = await this.storage.list(prefix, ORPHAN_SWEEP_LIST_LIMIT);
    const candidates = listed.filter((object) => object.lastModified.getTime() < cutoff.getTime());

    if (candidates.length === 0) {
      return EMPTY_NAMESPACE;
    }

    const live = await liveKeys(candidates.map((object) => object.key));

    let deleted = 0;
    let bytesReclaimed = 0;
    let bounded = false;

    for (const object of candidates) {
      if (this.cancelled) {
        break;
      }
      if (live.has(object.key)) {
        continue;
      }
      if (deleted >= ORPHAN_SWEEP_DELETE_LIMIT) {
        bounded = true;
        break;
      }

      const parsed = parseOwnedKey(object.key);
      if (parsed === null || parsed.namespace !== namespace) {
        // Not a key this codebase can have produced. Left alone deliberately: an object
        // nobody can explain is a reason to investigate the store, never a reason for a
        // cron job to delete it unattended.
        this.logger.warn(
          `An object under "${prefix}" does not match the §3.3 key layout and was left in ` +
            'place. Investigate the store rather than widening this sweep.',
        );
        continue;
      }

      if (await this.removeOrphan(object, parsed, now)) {
        deleted += 1;
        bytesReclaimed += object.byteSize;
      }
    }

    return { examined: candidates.length, deleted, bytesReclaimed, bounded };
  }

  /**
   * Removes one orphan and records it in `deletion_log`.
   *
   * **Object first, row second**, the same order and for the same reason as
   * `PurgeService.purgeOne`: the only reachable failure is a log row pointing at an object
   * that is already gone, which is true, versus a log row claiming a deletion that did not
   * happen, which is not. There is no transaction because there is no second table to keep
   * in step — the whole point of an orphan is that no row names it.
   *
   * `rowsDeleted` is `{}` on purpose, and it is the most informative field on the row: this
   * deletion removed bytes that **no** table knew about. `requestedAt` is the object's own
   * mtime, because the moment it became due is the moment it was written and abandoned.
   */
  private async removeOrphan(
    object: StoredObject,
    parsed: ParsedOwnedKey,
    now: Date,
  ): Promise<boolean> {
    const removed = await this.storage.delete(object.key);
    if (!removed) {
      // Someone else took it between the listing and here — an account deletion running
      // concurrently, most likely. Nothing was reclaimed, so nothing is recorded.
      return false;
    }

    await this.deletions.insert({
      subjectType: SUBJECT_BY_NAMESPACE[parsed.namespace],
      subjectId: parsed.objectId,
      userId: parsed.userId,
      initiatedBy: DeletionInitiator.PURGE_JOB,
      // System action (§4.30, §4.31): no person decided this.
      actorId: null,
      requestedAt: object.lastModified,
      completedAt: now,
      rowsDeleted: {},
      storageKeysDeleted: 1,
      bytesReclaimed: String(object.byteSize),
      verificationHash: sha256Hex(object.key),
      failureReason: null,
    });

    return true;
  }

  /** `person_photos.storageKey` for the candidates, **including soft-deleted rows**. */
  private async livePhotoKeys(candidates: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.photos.find({
      where: { storageKey: In([...candidates]) },
      withDeleted: true,
      select: { id: true, storageKey: true },
    });
    return new Set(rows.map((row) => row.storageKey));
  }

  /**
   * `tryon_results.storageKey` for the candidates, **including soft-deleted rows**, plus
   * every key a `tryon_cache` row still points at. See the class comment for both.
   */
  private async liveRenderKeys(candidates: readonly string[]): Promise<ReadonlySet<string>> {
    const keys = [...candidates];

    const [rows, cached] = await Promise.all([
      this.renders.find({
        where: { storageKey: In(keys) },
        withDeleted: true,
        select: { id: true, storageKey: true },
      }),
      this.cache.find({
        where: { storageKey: In(keys) },
        withDeleted: true,
        select: { id: true, storageKey: true },
      }),
    ]);

    return new Set([...rows.map((row) => row.storageKey), ...cached.map((row) => row.storageKey)]);
  }

  private log(report: OrphanSweepReport): void {
    const deleted = report.personPhotos.deleted + report.renders.deleted + report.exports.deleted;

    if (deleted === 0 && report.temporaryFilesDeleted === 0) {
      return;
    }

    this.logger.log(
      `Orphan sweep removed ${report.personPhotos.deleted} photo object(s), ` +
        `${report.renders.deleted} render object(s), ${report.exports.deleted} expired ` +
        `archive(s) and ${report.temporaryFilesDeleted} stale temporary file(s) ` +
        '(§3.5 step 4, §3.2 requirement 4). No object named by a row was touched (C-27).',
    );

    if (report.personPhotos.bounded || report.renders.bounded || report.exports.bounded) {
      this.logger.warn(
        'The orphan sweep hit its per-run delete bound. The remainder is still due and the ' +
          'next run will take it; a bound reached on consecutive runs means a real backlog.',
      );
    }
  }
}
