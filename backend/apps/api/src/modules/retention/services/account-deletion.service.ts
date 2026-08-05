import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, IsNull, Repository, type EntityManager } from 'typeorm';

import {
  ConflictException,
  ErrorCode,
  MILLISECONDS_PER_HOUR,
  NotFoundException,
  sha256Hex,
  UserStatus,
  type ICurrentUser,
} from '@library/common';
import { runInTransaction } from '@library/database';
import { TemplateId } from '@library/notifications';
import { StoragePrefixes, StorageService } from '@library/storage';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { NotificationsInboxService } from '@api/modules/notifications/services/notifications-inbox.service';
import { OutboxService } from '@api/modules/notifications/services/outbox.service';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShareLink } from '@api/modules/share/entities/share-link.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { DEFAULT_DELETION_SLA_HOURS, DELETION_BATCH_SIZE } from '../constants/retention.constants';
import { DeletionLogEntry } from '../entities/deletion-log-entry.entity';
import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';
import { ExportPrefixes } from '../utils/export-key.builder';

import type { DeletionReceiptResponseDto } from '../dto/deletion-receipt.dto';

/**
 * `verification_hash` at request time — §4.31.
 *
 * The column is `char(64)` NOT NULL and the deleted-key list is empty at the moment a
 * request is recorded, so the digest of the empty list is the honest value.
 * `AdminConsumersService` uses the same constant for the same reason.
 */
const EMPTY_MANIFEST_HASH = sha256Hex('');

/** What one account purge removed. Every number here ends up on the `deletion_log` row. */
export interface AccountPurgeResult {
  readonly userId: string;
  readonly rowsDeleted: Record<string, number>;
  readonly storageKeysDeleted: number;
  readonly bytesReclaimed: number;
  readonly verificationHash: string;
}

/**
 * **A-20, C-38, §9.3 — deletion, executed.**
 *
 * > A-20: "Delete a consumer and all associated photos, renders and shortlists.
 * > Completes within 24 hours with a confirmation record."
 * > C-38: "Deletion is immediate from her view and completes in the backend within 24
 * > hours."
 *
 * ### Two entry points, one execution path
 *
 * `modules/users` writes a `deletion_log` row with `completedAt = null` when an admin
 * calls `DELETE /admin/consumers/:userId` (A-20), and its own comment names this module
 * as the thing that finishes the job. `DELETE /me` (C-38) writes the identical row for
 * the consumer's own account. Both are then executed by exactly the same
 * {@link purgeAccount}, which is what makes "an admin deleted her" and "she deleted
 * herself" indistinguishable in outcome — as they should be.
 *
 * ### Completion is an **appended** row, not an update
 *
 * `deletion_log` is append-only and the migration backs it with
 * `CREATE RULE "no_update_deletion_log" … DO INSTEAD NOTHING`. So `UPDATE
 * deletion_log SET "completedAt" = now()` does not fail — **it silently does nothing**,
 * which is the worst possible outcome for the one table whose job is to prove that
 * something happened.
 *
 * Completion is therefore a **second row** with the same `(subjectType, subjectId)`,
 * carrying the original `requestedAt`, a real `completedAt`, the real `rowsDeleted`
 * manifest and the real verification hash. `IDX_deletion_log_subject` is the index that
 * makes pairing them cheap, and `IDX_deletion_log_completedAt WHERE "completedAt" IS
 * NULL` — which §4.31 calls "the alert query for E-14 purge failure" — is exactly the
 * set of requests with no completion yet.
 *
 * ### What "everything belonging to the account" means
 *
 * §9.3: "everything belonging to an account is removed on account deletion". Concretely,
 * inside one transaction:
 *
 * | Removed | Note |
 * | --- | --- |
 * | `person_photos` | rows **and** objects |
 * | `tryon_results` | rows and objects — C-27 says renders live for the life of the account, and the account is ending |
 * | `tryon_jobs`, `shortlist_items`, `share_links`, `votes` | cascade from `users`, but counted explicitly so the manifest is real |
 * | `enquiries` | see below |
 * | `notifications_outbox` | a notification addressed to her is hers |
 * | `renders/<id>/`, `person-photos/<id>/`, `exports/<id>/` | storage prefixes, dropped wholesale (§3.3) |
 * | `tryon_cache` rows pointing into her prefix | otherwise a dangling pointer to bytes that no longer exist |
 * | `users` | last |
 *
 * **Enquiries are anonymised rather than deleted.** An enquiry is a commercial record
 * between her and the studio and the studio is a party to it — A-21 snapshots her
 * contact details onto it precisely because it has to survive her profile changing. So
 * the personal columns are cleared and the row stays. That is the one place §9.3's
 * "everything" is read narrowly, it is read that way deliberately, and it is stated
 * here rather than left to be discovered.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  private running = false;
  private cancelled = false;

  constructor(
    @InjectRepository(DeletionLogEntry)
    private readonly deletions: Repository<DeletionLogEntry>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
    private readonly inbox: NotificationsInboxService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Stops the sweep between accounts. Called from the processor's shutdown hook. */
  cancel(): void {
    this.cancelled = true;
  }

  /* -----------------------------------------------------------------------------------------
   * C-38 — her own request
   * -------------------------------------------------------------------------------------- */

  /**
   * `DELETE /me` (C-38, §5.2).
   *
   * **Immediate from her view.** The response is written as soon as the request is
   * durable: her sessions are gone, the account is deactivated so nothing more can be
   * created against it, and a `deletion_log` row exists. The cascade itself runs on the
   * sweep, inside the SLA.
   *
   * Doing the whole purge inline would be worse for her, not better: deleting a
   * hundred renders and three storage prefixes is seconds of work she would spend
   * staring at a spinner, and a request that timed out halfway would leave her
   * account in a state with no record that she had asked. The row *is* the promise.
   */
  async requestSelfDeletion(user: ICurrentUser): Promise<DeletionReceiptResponseDto> {
    const account = await this.users.findOne({ where: { id: user.id } });
    if (account === null) {
      throw new NotFoundException(ErrorCode.USER_NOT_FOUND);
    }
    if (account.deletionRequestedAt !== null) {
      throw new ConflictException(ErrorCode.DELETION_IN_PROGRESS);
    }

    const requestedAt = new Date();
    const dueBy = new Date(requestedAt.getTime() + this.slaHours() * MILLISECONDS_PER_HOUR);

    const deletionLogId = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<string> => {
        await manager
          .getRepository(User)
          .update(
            { id: user.id },
            { deletionRequestedAt: requestedAt, status: UserStatus.DEACTIVATED },
          );

        const repository = manager.getRepository(DeletionLogEntry);
        const entry = await repository.save(
          repository.create({
            subjectType: DeletionSubject.USER,
            subjectId: user.id,
            userId: user.id,
            initiatedBy: DeletionInitiator.CONSUMER,
            actorId: user.id,
            requestedAt,
            completedAt: null,
            rowsDeleted: {},
            storageKeysDeleted: 0,
            bytesReclaimed: '0',
            verificationHash: EMPTY_MANIFEST_HASH,
            failureReason: null,
          }),
        );
        return entry.id;
      },
      { label: 'retention.requestSelfDeletion' },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.ACCOUNT_DELETION_REQUESTED,
        targetType: AUDIT_TARGET_TYPES.USER,
        actorId: user.id,
        actorRole: user.role,
        targetId: user.id,
        metadata: { initiatedBy: DeletionInitiator.CONSUMER, dueBy },
      }),
    );

    return {
      deletionLogId,
      subjectType: DeletionSubject.USER,
      subjectId: user.id,
      initiatedBy: DeletionInitiator.CONSUMER,
      requestedAt,
      dueBy,
      completedAt: null,
    };
  }

  /* -----------------------------------------------------------------------------------------
   * The sweep — A-20 and C-38, executed inside the SLA
   * -------------------------------------------------------------------------------------- */

  /** Requests with no completion row yet, oldest first. `DELETION_BATCH_SIZE` at a time. */
  async findPending(limit: number = DELETION_BATCH_SIZE): Promise<DeletionLogEntry[]> {
    const requests = await this.deletions.find({
      where: { subjectType: DeletionSubject.USER, completedAt: IsNull() },
      order: { requestedAt: 'ASC' },
      take: limit * 4,
    });

    if (requests.length === 0) {
      return [];
    }

    // A request is outstanding when no *completion* row exists for the same subject.
    // Completion is an append (see the class comment), so this is the pairing.
    const completed = await this.deletions.find({
      where: requests.map((request) => ({
        subjectType: DeletionSubject.USER,
        subjectId: request.subjectId,
      })),
      select: { id: true, subjectId: true, completedAt: true },
    });

    const settled = new Set(
      completed.filter((row) => row.completedAt !== null).map((row) => row.subjectId),
    );

    return requests.filter((request) => !settled.has(request.subjectId)).slice(0, limit);
  }

  /** Requests that will breach the SLA soon, for the E-14 alert. */
  async countOverdue(before: Date): Promise<number> {
    const pending = await this.findPending(DELETION_BATCH_SIZE * 10);
    return pending.filter((request) => request.requestedAt <= before).length;
  }

  /**
   * Executes every outstanding request, up to one batch.
   *
   * Never throws for a single account's failure: one consumer's cascade tripping over a
   * missing storage object must not stop the other nine from completing inside the SLA.
   * Each failure is recorded as a completion row with `failureReason` set — visible,
   * countable and, because it is a completion, not retried forever in a loop that hides
   * it. The caller raises the E-14 alert.
   */
  async sweep(now: Date = new Date()): Promise<{ completed: number; failed: number }> {
    if (this.running) {
      return { completed: 0, failed: 0 };
    }

    this.running = true;
    this.cancelled = false;

    try {
      const pending = await this.findPending();
      let completed = 0;
      let failed = 0;

      for (const request of pending) {
        if (this.cancelled) {
          break;
        }

        try {
          await this.execute(request, now);
          completed += 1;
        } catch (error: unknown) {
          failed += 1;
          await this.recordFailure(request, error, now);
        }
      }

      return { completed, failed };
    } finally {
      this.running = false;
    }
  }

  /**
   * Executes one request: purge, then append the completion row, then tell her.
   *
   * The confirmation email is queued through the outbox **inside** the same transaction
   * as the completion row (§4.32). Her account is gone by the time it is delivered, so
   * the address is written onto the row before the `users` row is deleted — the one
   * place in this codebase where `recipientAddress` is stored rather than resolved at
   * delivery time, and it is stored because there will shortly be nothing to resolve it
   * from.
   */
  async execute(request: DeletionLogEntry, now: Date = new Date()): Promise<AccountPurgeResult> {
    const account = await this.users.findOne({
      where: { id: request.subjectId },
      withDeleted: true,
    });

    const result = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<AccountPurgeResult> => {
        const purged = await this.purgeAccount(manager, request.subjectId);

        await manager.getRepository(DeletionLogEntry).insert({
          subjectType: DeletionSubject.USER,
          subjectId: request.subjectId,
          // The account is being removed and `deletion_log.userId` is `SET NULL` on
          // delete (§4.31), so the durable identifier is `subjectId` — which §4.31
          // describes as "retained after the row itself is gone".
          userId: null,
          initiatedBy: request.initiatedBy,
          actorId: request.actorId,
          requestedAt: request.requestedAt,
          completedAt: now,
          rowsDeleted: purged.rowsDeleted,
          storageKeysDeleted: purged.storageKeysDeleted,
          bytesReclaimed: String(purged.bytesReclaimed),
          verificationHash: purged.verificationHash,
          failureReason: null,
        });

        if (account !== null) {
          await this.outbox.enqueueWithin(manager, {
            template: TemplateId.ACCOUNT_DELETION_CONFIRMED,
            props: {
              consumerName: account.name,
              deletedAt: now,
              photosDeleted: purged.rowsDeleted.person_photos ?? 0,
              tryOnsDeleted: purged.rowsDeleted.tryon_results ?? 0,
              shareLinksRevoked: purged.rowsDeleted.share_links ?? 0,
            },
            // Stored, not resolved later: the account it would be resolved from is
            // deleted in this same transaction.
            recipientAddress: account.email,
            recipientUserId: null,
            locale: account.locale,
            dedupeKey: `account-deleted:${request.subjectId}`,
          });
        }

        return purged;
      },
      { label: 'retention.executeDeletion' },
    );

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.ACCOUNT_DELETION_COMPLETED,
        targetType: AUDIT_TARGET_TYPES.USER,
        actorId: null,
        actorRole: null,
        targetId: request.subjectId,
        metadata: {
          initiatedBy: request.initiatedBy,
          rowsDeleted: result.rowsDeleted,
          storageKeysDeleted: result.storageKeysDeleted,
          verificationHash: result.verificationHash,
          elapsedHours:
            Math.round(
              ((now.getTime() - request.requestedAt.getTime()) / MILLISECONDS_PER_HOUR) * 10,
            ) / 10,
        },
      }),
    );

    this.logger.log(
      `Account deletion completed for subject ${request.subjectId} (A-20, C-38). ` +
        `${result.storageKeysDeleted} object(s) removed.`,
    );

    return result;
  }

  /* -----------------------------------------------------------------------------------------
   * The cascade
   * -------------------------------------------------------------------------------------- */

  /**
   * Removes everything belonging to one account, inside the caller's transaction.
   *
   * Order matters in one place only: **the storage objects go before the rows that name
   * them.** Once a `tryon_results` row is gone there is nothing left that knows which
   * file it pointed at, and a file with no row is invisible to every later sweep — the
   * exact shape of leak §9.3 exists to prevent.
   *
   * `deletePrefix` on `renders/<userId>/` and `person-photos/<userId>/` (§3.3) is what
   * catches anything a row did not name: an orphan from a failed write, a thumbnail
   * whose row was pruned. The per-row deletes give an accurate byte count; the prefix
   * delete gives completeness. Both are needed and neither replaces the other.
   */
  async purgeAccount(manager: EntityManager, userId: string): Promise<AccountPurgeResult> {
    const photos = await manager.getRepository(PersonPhoto).find({ where: { userId } });
    const renders = await manager.getRepository(TryOnResult).find({
      where: { userId },
      withDeleted: true,
    });

    const namedKeys = [
      ...photos.flatMap((photo) => [photo.storageKey, photo.blurredThumbnailKey]),
      ...renders.flatMap((render) => [render.storageKey, render.thumbnailKey]),
    ];

    const removed = await this.deleteObjects(namedKeys);

    // Anything the rows did not name — orphans, thumbnails whose rows were pruned, and
    // every export archive she ever generated (C-39).
    const prefixCounts = await Promise.all([
      this.storage.deletePrefix(StoragePrefixes.personPhotosOfUser(userId)),
      this.storage.deletePrefix(StoragePrefixes.rendersOfUser(userId)),
      this.storage.deletePrefix(ExportPrefixes.ofUser(userId)),
    ]);
    const prefixDeleted = prefixCounts.reduce((sum, value) => sum + value, 0);

    // A cache row whose canonical copy was one of her renders now points at bytes that
    // no longer exist. Dropping the row costs a future regeneration; leaving it would
    // serve a 404 to whoever hit the key next (§3.7).
    const cacheRetired = await this.retireCacheFor(manager, renders);

    const rowsDeleted: Record<string, number> = {
      person_photos: await this.deleteWhere(manager, PersonPhoto, { userId }),
      tryon_results: await this.deleteWhere(manager, TryOnResult, { userId }),
      shortlist_items: await this.deleteWhere(manager, ShortlistItem, { userId }),
      share_links: await this.deleteWhere(manager, ShareLink, { userId }),
      tryon_jobs: await this.deleteWhere(manager, TryOnJob, { userId }),
      notifications_outbox: await this.inbox.purgeForUser(userId),
      enquiries_anonymised: await this.anonymiseEnquiries(manager, userId),
      tryon_cache: cacheRetired,
    };

    rowsDeleted.users = await this.deleteWhere(manager, User, { id: userId });

    return {
      userId,
      rowsDeleted,
      storageKeysDeleted: removed.keysDeleted + prefixDeleted,
      bytesReclaimed: removed.bytesReclaimed,
      verificationHash: removed.verificationHash,
    };
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Clears the personal columns an enquiry snapshotted (A-21) and keeps the row.
   *
   * See the class comment for why. The message body goes too: she wrote it, and a
   * sentence about her wedding is as personal as her phone number.
   */
  private async anonymiseEnquiries(manager: EntityManager, userId: string): Promise<number> {
    const result = await manager.getRepository(Enquiry).update(
      { userId },
      {
        contactName: 'Deleted account',
        contactEmail: '',
        contactPhone: '',
        message: '',
      },
    );
    return result.affected ?? 0;
  }

  /**
   * Retires `tryon_cache` rows whose canonical object was one of this account's renders.
   *
   * Matched on `cacheKey` **and** `storageKey` together: §3.7 makes the canonical copy
   * the requesting user's own render, so a row is only hers if it points at her file.
   * A row with the same key pointing at somebody else's copy is that person's and is
   * left alone.
   */
  private async retireCacheFor(
    manager: EntityManager,
    renders: readonly TryOnResult[],
  ): Promise<number> {
    if (renders.length === 0) {
      return 0;
    }

    const repository = manager.getRepository(TryOnCache);
    let retired = 0;

    for (const render of renders) {
      const result = await repository.delete({
        cacheKey: render.cacheKey,
        storageKey: render.storageKey,
      });
      retired += result.affected ?? 0;
    }
    return retired;
  }

  private async deleteWhere(
    manager: EntityManager,
    entity: Parameters<EntityManager['getRepository']>[0],
    where: Record<string, string>,
  ): Promise<number> {
    const result = await manager.getRepository(entity).delete(where);
    return result.affected ?? 0;
  }

  /** Same shape as the photo purge: measure with `head()` first, because after there is nothing. */
  private async deleteObjects(
    keys: readonly (string | null)[],
  ): Promise<{ keysDeleted: number; bytesReclaimed: number; verificationHash: string }> {
    const removed: string[] = [];
    let bytesReclaimed = 0;

    for (const key of keys) {
      if (key === null || key === '') {
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

  /**
   * Records a failed purge as a completion row with `failureReason` set.
   *
   * Not a retry loop. A cascade that failed once for a reason nobody has looked at will
   * fail again every fifteen minutes, and the sweep would spend its whole batch on it
   * while nine other consumers waited past their SLA. The row is the record; E-14 is the
   * escalation; a human is the retry.
   */
  private async recordFailure(request: DeletionLogEntry, error: unknown, now: Date): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);

    this.logger.error(
      `Account deletion failed for subject ${request.subjectId} (A-20, C-38): ${reason}`,
    );

    try {
      await this.deletions.insert({
        subjectType: DeletionSubject.USER,
        subjectId: request.subjectId,
        userId: request.userId,
        initiatedBy: request.initiatedBy,
        actorId: request.actorId,
        requestedAt: request.requestedAt,
        completedAt: now,
        rowsDeleted: {},
        storageKeysDeleted: 0,
        bytesReclaimed: '0',
        verificationHash: EMPTY_MANIFEST_HASH,
        failureReason: reason.slice(0, 2_000),
      });
    } catch (writeError: unknown) {
      this.logger.error(
        'The failure itself could not be recorded in deletion_log: ' +
          `${writeError instanceof Error ? writeError.message : String(writeError)}`,
      );
    }

    this.events.emit(
      AUDIT_RECORD_EVENT,
      new AuditRecordEvent({
        action: AUDIT_ACTIONS.PURGE_JOB_FAILED,
        targetType: AUDIT_TARGET_TYPES.DELETION_LOG,
        actorId: null,
        actorRole: null,
        targetId: request.id,
        metadata: { subjectId: request.subjectId, reason },
      }),
    );
  }

  private slaHours(): number {
    return this.config.get<number>('DELETION_SLA_HOURS') ?? DEFAULT_DELETION_SLA_HOURS;
  }

  /** The instant before which a pending request is at risk of breaching the SLA. */
  slaWarningCutoff(now: Date, fraction: number): Date {
    return new Date(now.getTime() - this.slaHours() * fraction * MILLISECONDS_PER_HOUR);
  }
}

/** Exported for the processor and the spec: requests older than this are overdue. */
export const overdueBefore = (now: Date, slaHours: number): Date =>
  new Date(now.getTime() - slaHours * MILLISECONDS_PER_HOUR);
