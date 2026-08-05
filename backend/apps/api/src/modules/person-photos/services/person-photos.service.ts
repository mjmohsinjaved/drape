import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  METRICS,
  MetricsService,
  NotFoundException,
  OwnershipException,
  sha256Hex,
  ValidationException,
} from '@library/common';
import type { ICurrentUser } from '@library/common';
import { runInTransaction } from '@library/database';
import { ImageService, StorageKeys, StoragePrefixes, StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { ConsentsService } from '@api/modules/consents/services/consents.service';
import { DeletionLogEntry } from '@api/modules/retention/entities/deletion-log-entry.entity';
import { DeletionInitiator } from '@api/modules/retention/enums/deletion-initiator.enum';
import { DeletionSubject } from '@api/modules/retention/enums/deletion-subject.enum';
import { RetentionPolicy } from '@api/modules/retention/services/retention-policy.service';
import { SettingsService } from '@api/modules/settings';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { BLURRED_THUMBNAIL_WIDTH, MAX_PHOTO_BYTES } from '../constants/person-photo.constants';
import { PersonPhoto } from '../entities/person-photo.entity';
import { PhotoModerationState } from '../enums/photo-moderation-state.enum';
import { PERSON_PHOTO_EVENTS, type PersonPhotoRemovedEvent } from '../events/person-photo.events';
import { toPersonPhotoResponse } from '../mappers/person-photo.mapper';
import { validatePersonPhoto } from '../validators/person-photo.validator';

import type { CreatePersonPhotoDto } from '../dto/create-person-photo.dto';
import type { PersonPhotoResponseDto } from '../dto/person-photo-response.dto';
import type { UpdatePersonPhotoDto } from '../dto/update-person-photo.dto';

/** What a storage removal actually accomplished, for the §9.3 deletion log. */
interface StorageRemoval {
  readonly keysDeleted: number;
  readonly bytesReclaimed: number;
  /** sha256 of the sorted deleted-key list — the "verifiable" in §9.3. */
  readonly verificationHash: string;
}

/**
 * PRD C-11 … C-16, C-28, C-38 · ARCHITECTURE §5.9 — a consumer's saved photographs.
 *
 * ### The four properties this class exists to hold
 *
 * **1. Nothing the client says about the file is trusted.** C-14's browser-side pass —
 * resolution, framing, blur, single subject — runs on a device the consumer controls
 * and can be skipped entirely by talking to the API directly. It is a courtesy that
 * saves her an upload, not the enforcement point. Every dimension, format, byte count
 * and sha256 on the stored row is re-derived here from the bytes on disk, and the key
 * must sit under **her own** `person-photos/<userId>/` prefix or the finalise call is
 * refused outright. EXIF was already stripped when the ticket was redeemed (§3.6,
 * `modules/files`); this module does not re-implement that and does not open a second
 * upload path.
 *
 * **2. Exactly one active photo, without a read-then-write race.** C-16 lets her keep
 * several photographs and choose between them. "Exactly one" is enforced by
 * `UQ_person_photos_active UNIQUE ("userId") WHERE "isActive" = true AND "deletedAt"
 * IS NULL` (§4.16) and by doing the demote-then-promote pair as two conditional
 * `UPDATE`s inside one transaction — never by loading rows, deciding in JavaScript and
 * saving them back. Two devices activating different photos in the same instant
 * serialise on that index; whichever commits second either demotes the first winner
 * and promotes its own, or fails on the constraint. Neither outcome can leave her with
 * two active photos or none.
 *
 * **3. A render outlives the photo it came from.** C-28. `tryon_results.personPhotoId`
 * is `ON DELETE SET NULL` with a `personPhotoLabelSnapshot` beside it (§4.18), so
 * deleting a photograph nulls the reference and leaves the render, its history entry
 * and its C-30 grouping label untouched. This service therefore **hard-deletes** the
 * `person_photos` row — that is what fires the `SET NULL` — and never cascades, never
 * touches `tryon_results`, and never asks whether a render exists first.
 *
 * **4. Deleting announces itself; it does not clean up after other modules.** C-16
 * retires the removed photograph's `tryon_cache` rows. That table belongs to the
 * `tryon` module (§4.33) and — crucially — retirement is **hygiene, not correctness**:
 * the §3.7 cache key already contains `personPhotoHash`, so a try-on against a
 * different photograph derives a different key and cannot hit a render built from the
 * old one, whether or not the old rows were ever swept. Because the work may be
 * eventual, this class emits {@link PERSON_PHOTO_EVENTS.REMOVED} after the commit and
 * stops there. It holds no reference to a cache, no port and no token, and a deletion
 * cannot be slowed down or blocked by one.
 *
 * ### What is deliberately absent
 *
 * **Any admin route at all** (PRD S-10, §5.9). Not a read-only one, not a blurred one,
 * not a count. The blurred moderation thumbnail is reachable only through the A-34
 * queue in `modules/moderation`, against an audit-logged, admin-subject signed URL.
 * Every method here takes a `userId` and puts it in the `where` clause, so there is no
 * query shape in this file that could return another account's row even if a route
 * were added carelessly.
 */
@Injectable()
export class PersonPhotosService {
  private readonly logger = new Logger(PersonPhotosService.name);

  constructor(
    @InjectRepository(PersonPhoto)
    private readonly photos: Repository<PersonPhoto>,
    // `DeletionLogEntry` has no injected repository on purpose: the only write to it
    // in this module happens through the transactional `EntityManager` in `remove()`,
    // beside the row delete it records (§2.9 rule 3). An injected repository here
    // would be a second, non-transactional way to write the §9.3 log.
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly imageProcessor: ImageService,
    private readonly settings: SettingsService,
    private readonly consents: ConsentsService,
    // §9.3 retention is one policy, owned by `modules/retention`. This service used to
    // read `PHOTO_RETENTION_DAYS` itself and multiply by it unvalidated, so
    // `PHOTO_RETENTION_DAYS=0` wrote `purgeAfter = now` on every upload while the purge
    // cron — which *did* validate — was still keeping photographs for thirty days.
    private readonly retention: RetentionPolicy,
    private readonly metrics: MetricsService,
    private readonly events: EventEmitter2,
  ) {}

  /* -----------------------------------------------------------------------------------------
   * Consumer routes (§5.9)
   * -------------------------------------------------------------------------------------- */

  /** `GET /person-photos` — her saved photos, active first, newest first (C-16). */
  async list(userId: string): Promise<PersonPhotoResponseDto[]> {
    const rows = await this.photos.find({
      where: { userId },
      order: { isActive: 'DESC', uploadedAt: 'DESC' },
    });
    return rows.map((row) => this.present(row));
  }

  /**
   * `POST /person-photos` — finalise a redeemed upload ticket (§5.9, §3.5 step 3).
   *
   * Consent first, before anything is read or written. C-11 calls the consent screen
   * "a hard gate, nothing pre-checked, not skippable", and a photograph accepted into
   * storage before that gate has been passed is a photograph held without permission,
   * whatever happens to the row afterwards.
   */
  async create(actor: ICurrentUser, dto: CreatePersonPhotoDto): Promise<PersonPhotoResponseDto> {
    await this.consents.assertConsentIsCurrent(actor.id);

    const stored = await this.requireOwnObject(actor.id, dto.key);
    await this.assertBelowPhotoLimit(actor.id);

    const buffer = await this.storage.getBuffer(dto.key);
    const metadata = await this.imageProcessor.metadata(buffer);

    const verdict = validatePersonPhoto({
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      byteSize: stored.byteSize,
    });

    if (!verdict.passed) {
      // The object is worthless now — an unowned key is swept by the retention cron
      // after six hours (§3.5 step 4), but leaving a rejected photograph on disk for
      // six hours is six hours longer than we were given permission for.
      await this.deleteObjects([dto.key]);
      throw new ValidationException(ErrorCode.PHOTO_VALIDATION_FAILED, {
        details: { checks: verdict.failures },
      });
    }

    const blurredThumbnailKey = await this.writeBlurredThumbnail(buffer);
    const activate = dto.activate ?? (await this.countPhotos(actor.id)) === 0;
    // §4.16 — `COALESCE(users.lastActiveAt, users.createdAt) + PHOTO_RETENTION_DAYS`,
    // read from her row rather than from `Date.now()`, so the value written here is the
    // one the nightly recompute derives instead of a row it has to correct.
    const purgeAfter = await this.retention.purgeDateForUser(actor.id);

    const draft = this.photos.create({
      userId: actor.id,
      storageKey: dto.key,
      blurredThumbnailKey,
      // The sha256 the driver computed while streaming (§3.2 rule 7) — the
      // `personPhotoHash` half of the §3.7 cache key.
      hash: stored.etag,
      isActive: false,
      label: dto.label ?? null,
      uploadedAt: new Date(),
      purgeAfter,
      moderationState: PhotoModerationState.PENDING,
      width: metadata.width,
      height: metadata.height,
      byteSize: stored.byteSize,
      mimeType: stored.contentType,
    });

    const saved = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<PersonPhoto> => {
        const repository = manager.getRepository(PersonPhoto);
        const inserted = await repository.save(draft);
        if (activate) {
          await this.promoteWithin(manager, actor.id, inserted.id);
          inserted.isActive = true;
        }
        return inserted;
      },
      { label: 'person-photos.create' },
    );

    this.metrics.increment(METRICS.FUNNEL_PHOTO_UPLOADED);

    return this.present(saved);
  }

  /**
   * `POST /person-photos/:photoId/activate` — choose the active photo (C-16).
   *
   * The pair of conditional updates below is the whole mechanism. There is no
   * `find()`, no `isActive = !isActive` in JavaScript and no `save()` of a loaded
   * entity, because all three would read a value, think about it, and write back a
   * decision that a concurrent request had already invalidated. Demote-by-predicate
   * then promote-by-id, inside one transaction, cannot interleave into two active
   * rows: the partial unique index refuses the second writer.
   */
  async activate(userId: string, photoId: string): Promise<PersonPhotoResponseDto> {
    const photo = await this.assertOwnedPhoto(userId, photoId);

    if (photo.moderationState === PhotoModerationState.BLOCKED) {
      throw new ConflictException(ErrorCode.PHOTO_BLOCKED_BY_MODERATION);
    }

    const activated = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<PersonPhoto> => {
        await this.promoteWithin(manager, userId, photoId);
        const reloaded = await manager
          .getRepository(PersonPhoto)
          .findOne({ where: { id: photoId, userId } });
        return reloaded ?? Object.assign(photo, { isActive: true });
      },
      { label: 'person-photos.activate' },
    );

    return this.present(activated);
  }

  /** `PATCH /person-photos/:photoId` — rename the label (§5.9). */
  async rename(
    userId: string,
    photoId: string,
    dto: UpdatePersonPhotoDto,
  ): Promise<PersonPhotoResponseDto> {
    const photo = await this.assertOwnedPhoto(userId, photoId);

    if (dto.label === undefined) {
      return this.present(photo);
    }

    // `{ id, userId }`, not `{ id }` — the ownership predicate is repeated on the
    // write, so a row can never be modified by an id alone (§9.2).
    await this.photos.update({ id: photoId, userId }, { label: dto.label });
    photo.label = dto.label;

    return this.present(photo);
  }

  /**
   * `DELETE /person-photos/:photoId` — remove the photograph and its files (C-16, C-38).
   *
   * ### Order of operations, and why it is this order
   *
   * The objects are removed **inside** the transaction, before the row. It reads
   * oddly — a side effect in a transactional block — but the alternatives are worse.
   * Writing the `deletion_log` row after the commit would put two tables outside one
   * transaction (§2.9 rule 3); writing it inside with guessed numbers would make the
   * §9.3 "verifiable deletion log" unverifiable; and `deletion_log` carries a
   * `no_update_deletion_log` rule, so the row cannot be completed later. Deleting the
   * bytes first and the row second means the only reachable failure mode is a row
   * pointing at objects that are already gone — and the next `DELETE` retries it
   * successfully, because `StorageService.delete()` is idempotent and returns `false`
   * for an object that was already absent.
   *
   * ### What is *not* touched
   *
   * `tryon_results`. Not a soft delete, not a cascade, not a nulling `UPDATE`. The
   * `ON DELETE SET NULL` foreign key (§4.18) nulls `personPhotoId` for us, the render
   * keeps its `personPhotoLabelSnapshot`, and C-28 holds. The spec beside this file
   * proves it.
   */
  async remove(actor: ICurrentUser, photoId: string): Promise<void> {
    const photo = await this.assertOwnedPhoto(actor.id, photoId);
    const requestedAt = new Date();

    const removal = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<StorageRemoval> => {
        const result = await this.deleteObjects([photo.storageKey, photo.blurredThumbnailKey]);

        // Hard delete, deliberately: it is what fires `ON DELETE SET NULL` on
        // `tryon_results.personPhotoId` and leaves her history standing (C-28).
        await manager.getRepository(PersonPhoto).delete({ id: photo.id, userId: actor.id });

        await manager.getRepository(DeletionLogEntry).insert({
          subjectType: DeletionSubject.PERSON_PHOTO,
          subjectId: photo.id,
          userId: actor.id,
          initiatedBy: DeletionInitiator.CONSUMER,
          actorId: actor.id,
          requestedAt,
          // C-38 gives 24 hours; a single photograph is done before the response is
          // written, so the record says so rather than leaving a promise open.
          completedAt: new Date(),
          rowsDeleted: { person_photos: 1 },
          storageKeysDeleted: result.keysDeleted,
          bytesReclaimed: String(result.bytesReclaimed),
          verificationHash: result.verificationHash,
          failureReason: null,
        });

        return result;
      },
      { label: 'person-photos.remove' },
    );

    // Both after the commit (§2.9 rule 3), and both fire-and-forget. C-38 makes the
    // deletion itself the only thing that has to be right: a cache row that outlives
    // its photograph costs one wasted cache hit, while a photograph that could not be
    // deleted because another module was unreachable costs her the privacy guarantee.
    this.emitRemoved(photo);
    this.emitDeletionAudit(photo, actor, removal);
  }

  /* -----------------------------------------------------------------------------------------
   * The surface `modules/tryon` consumes (§8.1 step 3)
   * -------------------------------------------------------------------------------------- */

  /**
   * The photo a generation will run against: the one she named, or her active one.
   *
   * This is the whole of the photo half of the §8.1 step-3 guard chain — ownership,
   * existence and moderation state — in one call, so the try-on module never has to
   * assemble those three checks itself and never has to remember their order.
   *
   * @throws `PHOTO_NOT_FOUND` when she has no photo at all, or none active
   * @throws `PHOTO_NOT_OWNED` (masked to `PHOTO_NOT_FOUND` by §2.4) for another account's id
   * @throws `PHOTO_BLOCKED_BY_MODERATION` when the photo is blocked (A-34)
   */
  async resolveGenerationPhoto(userId: string, photoId?: string | null): Promise<PersonPhoto> {
    const photo =
      photoId === undefined || photoId === null
        ? await this.findActivePhoto(userId)
        : await this.assertOwnedPhoto(userId, photoId);

    if (photo === null) {
      throw new NotFoundException(ErrorCode.PHOTO_NOT_FOUND);
    }
    if (photo.moderationState === PhotoModerationState.BLOCKED) {
      throw new ConflictException(ErrorCode.PHOTO_BLOCKED_BY_MODERATION);
    }
    return photo;
  }

  /** Her active photo, or `null`. C-16 guarantees there is at most one (§4.16). */
  async findActivePhoto(userId: string): Promise<PersonPhoto | null> {
    return this.photos.findOne({ where: { userId, isActive: true } });
  }

  /**
   * Loads a photo **and** proves it belongs to `userId`, in a single predicate.
   *
   * §9.2: ownership is "never inferred from an unguessable ID". The `userId` is in
   * the `where` clause rather than compared after the fact, so there is no branch in
   * which a row for another account has been loaded into memory at all.
   *
   * The `PHOTO_NOT_OWNED` / `PHOTO_NOT_FOUND` distinction is real but invisible: §2.4
   * masks the former to the latter before it reaches the client, so a caller probing
   * ids cannot tell an id that exists elsewhere from one that never existed.
   */
  async assertOwnedPhoto(userId: string, photoId: string): Promise<PersonPhoto> {
    const photo = await this.photos.findOne({ where: { id: photoId, userId } });
    if (photo !== null) {
      return photo;
    }

    // Neither branch carries `details`. The mask rewrites the code and drops the
    // details of the *masked* branch, so a `{ photoId }` on the not-found branch alone
    // would have made the two responses different lengths — the mask defeated by the
    // one field it does not rewrite. The id is already in the request; there is
    // nothing for a client to learn from it here.
    const existsElsewhere = await this.photos.exists({ where: { id: photoId } });
    if (existsElsewhere) {
      throw new OwnershipException(ErrorCode.PHOTO_NOT_OWNED);
    }
    throw new NotFoundException(ErrorCode.PHOTO_NOT_FOUND);
  }

  /**
   * A signed, expiring URL for a photo, scoped to the account that owns it (§3.4).
   *
   * The subject comes from `photo.userId`, never from a caller-supplied id, so there
   * is no argument any call site could pass that would widen the token.
   */
  signedUrlFor(photo: Pick<PersonPhoto, 'storageKey' | 'userId'>): string {
    return this.storage.signedUrl(photo.storageKey, photo.userId);
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Demote every active row for this user, then promote one. Two statements, one
   * transaction, ordered so the partial unique index is never asked to hold two.
   */
  private async promoteWithin(
    manager: EntityManager,
    userId: string,
    photoId: string,
  ): Promise<void> {
    const repository = manager.getRepository(PersonPhoto);
    await repository.update({ userId, isActive: true }, { isActive: false });
    await repository.update({ id: photoId, userId }, { isActive: true });
  }

  /**
   * The key must name a real object under **this consumer's own** prefix.
   *
   * The ticket that produced the key was already scoped to her (`owner: 'SELF'` in
   * `UPLOAD_PURPOSE_POLICIES`), so a key from any other prefix means the client is not
   * using a key it was given — which is either a bug or an attempt to file somebody
   * else's object, or a garment image, as her photograph.
   */
  private async requireOwnObject(
    userId: string,
    key: string,
  ): Promise<{ etag: string; byteSize: number; contentType: string }> {
    if (!key.startsWith(StoragePrefixes.personPhotosOfUser(userId))) {
      throw new ValidationException(ErrorCode.STORAGE_PATH_REJECTED, {
        message: 'That upload does not belong to your account. Start the upload again.',
      });
    }

    const stored = await this.storage.head(key);
    if (stored === null) {
      throw new NotFoundException(ErrorCode.FILE_NOT_FOUND);
    }
    if (stored.byteSize > MAX_PHOTO_BYTES) {
      throw new ValidationException(ErrorCode.IMAGE_TOO_LARGE, {
        details: { maxMb: Math.round(MAX_PHOTO_BYTES / (1024 * 1024)) },
      });
    }
    return stored;
  }

  /** C-16 via `photos.maxPerConsumer` (A-27 registry, default 5). */
  private async assertBelowPhotoLimit(userId: string): Promise<void> {
    const max = await this.settings.getNumber(SETTINGS_KEYS.PHOTOS_MAX_PER_CONSUMER);
    if (max > 0 && (await this.countPhotos(userId)) >= max) {
      throw new ConflictException(ErrorCode.PHOTO_LIMIT_REACHED, { details: { max } });
    }
  }

  private async countPhotos(userId: string): Promise<number> {
    return this.photos.count({ where: { userId } });
  }

  /**
   * §3.6 / A-34 — the blurred 160w derivative, generated on write.
   *
   * It is the **only** thing an admin can ever be shown of a consumer's photograph
   * (S-10), and it is generated here rather than in the moderation queue so no code
   * path exists that reads the unblurred bytes on an admin's behalf.
   */
  private async writeBlurredThumbnail(buffer: Buffer): Promise<string | null> {
    try {
      const blurred = await this.imageProcessor.toBlurredModerationThumbnail(buffer);
      const key = StorageKeys.thumbnail('person-blurred', BLURRED_THUMBNAIL_WIDTH);
      await this.storage.put(key, blurred, { contentType: 'image/webp' });
      return key;
    } catch {
      // A missing blurred thumbnail costs the A-34 queue a placeholder. A rejected
      // upload because the blur encoder tripped costs her the photograph.
      this.logger.warn('Could not generate a blurred moderation thumbnail for a new photo.');
      return null;
    }
  }

  /**
   * Removes objects and reports what it actually accomplished.
   *
   * The byte count is read with `head()` before the delete, because after it there is
   * nothing left to measure — and `deletion_log.bytesReclaimed` is the number §9.3
   * asks a regulator to check.
   */
  private async deleteObjects(keys: readonly (string | null)[]): Promise<StorageRemoval> {
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

  private present(photo: PersonPhoto): PersonPhotoResponseDto {
    return toPersonPhotoResponse(photo, (key, subject) => this.storage.signedUrl(key, subject));
  }

  /**
   * C-16 — announce that a photograph is gone. **The only thing this module does
   * about the try-on cache.**
   *
   * `TryOnModule` listens and retires the `tryon_cache` rows built from this hash
   * (§4.19, §3.7). Nothing is awaited and nothing is returned: retirement is hygiene,
   * the §3.7 key already guarantees a later try-on cannot serve a render made from a
   * photograph she no longer holds, and a deletion must not wait on — or fail
   * because of — another module's table.
   *
   * The hash and nothing else. No storage key, no signed URL, no bytes (E-12).
   */
  private emitRemoved(photo: PersonPhoto): void {
    const event: PersonPhotoRemovedEvent = {
      userId: photo.userId,
      photoId: photo.id,
      personPhotoHash: photo.hash,
      wasActive: photo.isActive,
      occurredAt: new Date(),
    };

    this.events.emit(PERSON_PHOTO_EVENTS.REMOVED, event);
  }

  /**
   * A-3 / §9.3 — emitted, never written here (§2.9 rule 4).
   *
   * No `storageKey`, no `key`, no signed URL, no label. A photograph's key is exactly
   * the thing E-12 says must never appear in a log line, and the audit row's job is to
   * record that a deletion happened, not to describe what was deleted.
   */
  private emitDeletionAudit(
    photo: PersonPhoto,
    actor: ICurrentUser,
    removal: StorageRemoval,
  ): void {
    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.PERSON_PHOTO_DELETED,
        targetType: AUDIT_TARGET_TYPES.PERSON_PHOTO,
        actorId: actor.id,
        actorRole: actor.role,
        targetId: photo.id,
        metadata: {
          storageKeysDeleted: removal.keysDeleted,
          bytesReclaimed: removal.bytesReclaimed,
          wasActive: photo.isActive,
        },
      }),
    );
  }
}
