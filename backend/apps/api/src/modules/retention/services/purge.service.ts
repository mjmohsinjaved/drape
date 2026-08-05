import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, LessThanOrEqual, Repository, type EntityManager } from 'typeorm';

import { sha256Hex } from '@library/common';
import { runInTransaction } from '@library/database';
import { StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import {
  PERSON_PHOTO_EVENTS,
  type PersonPhotoRemovedEvent,
} from '@api/modules/person-photos/events/person-photo.events';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { DEFAULT_PHOTO_RETENTION_DAYS, PURGE_BATCH_SIZE } from '../constants/retention.constants';
import { DeletionLogEntry } from '../entities/deletion-log-entry.entity';
import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** What one purge run accomplished. */
export interface PurgeReport {
  readonly photosDeleted: number;
  readonly storageKeysDeleted: number;
  readonly bytesReclaimed: number;
  /** Rows whose `purgeAfter` was brought back in line with `users.lastActiveAt`. */
  readonly datesRecomputed: number;
  /** True when the run stopped early because the process is shutting down. */
  readonly cancelled: boolean;
}

const EMPTY_REPORT: PurgeReport = {
  photosDeleted: 0,
  storageKeysDeleted: 0,
  bytesReclaimed: 0,
  datesRecomputed: 0,
  cancelled: false,
};

/**
 * **§9.3 — "person photos deleted 30 days after last account activity."**
 *
 * ### The sentence this class must never violate
 *
 * > **C-27: "Renders persist for the life of the account. They are not subject to a
 * > time-based purge and are removed only when she deletes them individually or deletes
 * > her account."**
 *
 * There is no query in this file that names `tryon_results`. Not a filtered one, not a
 * cautious one — none. `PurgeService` does not inject the repository, the module does
 * not register the entity for it, and the spec beside this file asserts that a purge run
 * over a database full of expired photographs and their renders leaves every render
 * standing. §4.18 is the other half of the guarantee: `tryon_results.personPhotoId` is
 * `ON DELETE SET NULL` with a `personPhotoLabelSnapshot` beside it, so deleting the
 * photograph nulls a column in her history instead of removing a row from it (C-28).
 *
 * The reason this matters enough to be structural rather than careful: a render costs
 * her quota and the brand money to produce (§9.3's own justification), and it is the
 * only artefact of the whole product she keeps. A purge that took one would be
 * unrecoverable and silent.
 *
 * ### Why `purgeAfter` is recomputed before anything is deleted
 *
 * §4.16 defines `person_photos.purgeAfter` as "`users.lastActiveAt + 30 days`,
 * **recomputed by the purge cron**". It is written once at upload and would otherwise
 * be a countdown from the day she uploaded, not from the day she was last here — so a
 * consumer who uses the product weekly for a year would have her photograph deleted
 * from under her on day 31. The recompute is the first thing a run does, and it is what
 * makes the stored column a cache of the policy rather than a second version of it.
 *
 * ### Cancellable, non-overlapping, and bounded
 *
 * One run at a time ({@link running}), stops between batches on shutdown
 * ({@link cancel}), and never deletes more than {@link PURGE_BATCH_SIZE} photographs in
 * a pass. A run interrupted halfway has deleted whole photographs, each in its own
 * transaction with its own `deletion_log` row — never half of one.
 */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  private running = false;
  private cancelled = false;

  constructor(
    @InjectRepository(PersonPhoto)
    private readonly photos: Repository<PersonPhoto>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  /** True while a run is in flight. The scheduler asks before starting another. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Stops the current run between batches. Called from the processor's shutdown hook. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * One purge pass — recompute, then delete what is due.
   *
   * Throws on failure rather than swallowing: the caller ({@link RetentionProcessor})
   * is the thing that knows an operator needs to hear about it (E-14), and a service
   * that silently returned an empty report would make a broken purge indistinguishable
   * from a quiet night.
   */
  async purgeExpiredPhotos(now: Date = new Date()): Promise<PurgeReport> {
    if (this.running) {
      this.logger.debug('A purge run is already in flight; this tick does nothing.');
      return EMPTY_REPORT;
    }

    this.running = true;
    this.cancelled = false;

    try {
      const datesRecomputed = await this.recomputePurgeDates();
      const due = await this.photos.find({
        where: { purgeAfter: LessThanOrEqual(now) },
        order: { purgeAfter: 'ASC' },
        take: PURGE_BATCH_SIZE,
      });

      let photosDeleted = 0;
      let storageKeysDeleted = 0;
      let bytesReclaimed = 0;

      for (const photo of due) {
        if (this.cancelled) {
          this.logger.log(
            `Purge cancelled after ${photosDeleted} photo(s); the rest are still due and ` +
              'the next run will take them.',
          );
          return {
            photosDeleted,
            storageKeysDeleted,
            bytesReclaimed,
            datesRecomputed,
            cancelled: true,
          };
        }

        const removed = await this.purgeOne(photo, now);
        photosDeleted += 1;
        storageKeysDeleted += removed.keysDeleted;
        bytesReclaimed += removed.bytesReclaimed;
      }

      if (photosDeleted > 0) {
        this.logger.log(
          `Purged ${photosDeleted} expired photo(s) and ${storageKeysDeleted} object(s) ` +
            `(§9.3). No render was touched (C-27).`,
        );
      }

      return {
        photosDeleted,
        storageKeysDeleted,
        bytesReclaimed,
        datesRecomputed,
        cancelled: false,
      };
    } finally {
      this.running = false;
    }
  }

  /** How many photographs are past their date right now — the E-14 backlog figure. */
  async countDue(now: Date = new Date()): Promise<number> {
    return this.photos.count({ where: { purgeAfter: LessThanOrEqual(now) } });
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * §4.16 — bring `purgeAfter` in line with `users.lastActiveAt + PHOTO_RETENTION_DAYS`.
   *
   * One correlated `UPDATE` rather than a read-then-write loop: the set is "every
   * photograph whose stored date disagrees with the policy", which is usually empty and
   * occasionally everybody, and neither case wants a round trip per row.
   *
   * An account with no `lastActiveAt` at all — signed up, never returned — is dated from
   * `users.createdAt`. The alternative is a photograph with no expiry, which is the one
   * outcome §9.3 does not permit.
   */
  private async recomputePurgeDates(): Promise<number> {
    const days = this.retentionDays();

    const result = await this.photos
      .createQueryBuilder()
      .update(PersonPhoto)
      .set({
        purgeAfter: (): string =>
          `(SELECT COALESCE(u."lastActiveAt", u."createdAt") + INTERVAL '${days} days' ` +
          `FROM "users" u WHERE u."id" = "person_photos"."userId")`,
      })
      .where(
        `"purgeAfter" IS DISTINCT FROM (
           SELECT COALESCE(u."lastActiveAt", u."createdAt") + INTERVAL '${days} days'
           FROM "users" u WHERE u."id" = "person_photos"."userId")`,
      )
      .andWhere('"deletedAt" IS NULL')
      .execute();

    const recomputed = result.affected ?? 0;
    if (recomputed > 0) {
      this.logger.debug(`Recomputed ${recomputed} purge date(s) from lastActiveAt (§4.16).`);
    }
    return recomputed;
  }

  /**
   * Deletes one photograph: its objects, its row, and a completed `deletion_log` entry —
   * all in a single transaction.
   *
   * The objects go **before** the row, inside the transaction. It reads oddly, and
   * `PersonPhotosService.remove()` documents the same choice for the same reason: the
   * alternatives are worse. Writing the log row after the commit puts two tables outside
   * one transaction (§2.9 rule 3); writing it inside with guessed numbers makes the §9.3
   * "verifiable deletion log" unverifiable; and `deletion_log` carries a
   * `no_update_deletion_log` rule, so a row written first cannot be completed later. The
   * only reachable failure is a row pointing at objects that are already gone, and the
   * next run retries it successfully because `StorageService.delete()` is idempotent.
   *
   * A **hard** delete, deliberately: it is what fires `ON DELETE SET NULL` on
   * `tryon_results.personPhotoId` and leaves her history standing (C-28, §4.18). A soft
   * delete would leave the row — and therefore her photograph's metadata — in the
   * database forever, which is not what §9.3 promised.
   */
  private async purgeOne(
    photo: PersonPhoto,
    now: Date,
  ): Promise<{ keysDeleted: number; bytesReclaimed: number }> {
    const removal = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager) => {
        const result = await this.deleteObjects([photo.storageKey, photo.blurredThumbnailKey]);

        await manager.getRepository(PersonPhoto).delete({ id: photo.id });

        await manager.getRepository(DeletionLogEntry).insert({
          subjectType: DeletionSubject.PERSON_PHOTO,
          subjectId: photo.id,
          userId: photo.userId,
          initiatedBy: DeletionInitiator.PURGE_JOB,
          // No actor: §4.30 and §4.31 both use null for a system action, and inventing
          // one would put a person's name against a cron job's decision.
          actorId: null,
          requestedAt: photo.purgeAfter,
          completedAt: now,
          rowsDeleted: { person_photos: 1 },
          storageKeysDeleted: result.keysDeleted,
          bytesReclaimed: String(result.bytesReclaimed),
          verificationHash: result.verificationHash,
          failureReason: null,
        });

        return result;
      },
      { label: 'retention.purgeOne' },
    );

    // Both after the commit (§2.9 rule 3). The cache retirement reuses the event
    // `person-photos` already publishes, so `tryon` needs no second listener and this
    // module needs no handle on `tryon_cache` for the photo path.
    const event: PersonPhotoRemovedEvent = {
      userId: photo.userId,
      photoId: photo.id,
      personPhotoHash: photo.hash,
      wasActive: photo.isActive,
      occurredAt: now,
    };
    this.events.emit(PERSON_PHOTO_EVENTS.REMOVED, event);

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.PERSON_PHOTO_DELETED,
        targetType: AUDIT_TARGET_TYPES.PERSON_PHOTO,
        // System action (§4.30).
        actorId: null,
        actorRole: null,
        targetId: photo.id,
        metadata: {
          initiatedBy: DeletionInitiator.PURGE_JOB,
          keysDeleted: removal.keysDeleted,
          bytesReclaimed: removal.bytesReclaimed,
        },
      }),
    );

    return removal;
  }

  /**
   * Removes objects and reports what it actually accomplished.
   *
   * The byte count is read with `head()` **before** the delete, because afterwards there
   * is nothing left to measure — and `deletion_log.bytesReclaimed` is the number §9.3
   * asks a regulator to check.
   */
  private async deleteObjects(
    keys: readonly (string | null)[],
  ): Promise<{ keysDeleted: number; bytesReclaimed: number; verificationHash: string }> {
    const removed: string[] = [];
    let bytesReclaimed = 0;

    for (const key of keys) {
      if (key === null) {
        continue;
      }
      const stored = await this.storage.head(key);
      const deleted = await this.storage.delete(key);
      if (deleted) {
        removed.push(key);
        bytesReclaimed += stored?.byteSize ?? 0;
      }
    }

    return {
      keysDeleted: removed.length,
      bytesReclaimed,
      verificationHash: sha256Hex([...removed].sort().join('\n')),
    };
  }

  private retentionDays(): number {
    const configured = this.config.get<number>('PHOTO_RETENTION_DAYS');
    const days = configured ?? DEFAULT_PHOTO_RETENTION_DAYS;
    // Interpolated into SQL, so it is proved to be an integer first. A retention policy
    // is a number from the environment and this is the one place it becomes a literal.
    return Number.isInteger(days) && days > 0 ? days : DEFAULT_PHOTO_RETENTION_DAYS;
  }
}

/**
 * The policy the recompute applies, as a pure function — §9.3, §4.16.
 *
 * The `UPDATE` above expresses it in SQL because it has to run over a whole table at
 * once; this is the same rule in TypeScript, so a test can state what "30 days after
 * last account activity" means without a database.
 */
export const purgeDateFor = (lastActiveAt: Date, retentionDays: number): Date =>
  new Date(lastActiveAt.getTime() + retentionDays * MILLISECONDS_PER_DAY);
