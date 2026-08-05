import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, In, IsNull, Not, Repository, type EntityManager } from 'typeorm';

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
import { EnquiryItem } from '@api/modules/enquiries/entities/enquiry-item.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { ModerationItem } from '@api/modules/moderation/entities/moderation-item.entity';
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

import {
  DEFAULT_DELETION_SLA_HOURS,
  DELETION_BATCH_SIZE,
  DELETION_MAX_ATTEMPTS,
} from '../constants/retention.constants';
import { DeletionLogEntry } from '../entities/deletion-log-entry.entity';
import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

import type { DeletionReceiptResponseDto } from '../dto/deletion-receipt.dto';

/**
 * `verification_hash` at request time — §4.31.
 *
 * The column is `char(64)` NOT NULL and the deleted-key list is empty at the moment a
 * request is recorded, so the digest of the empty list is the honest value.
 * `AdminConsumersService` uses the same constant for the same reason.
 */
const EMPTY_MANIFEST_HASH = sha256Hex('');

/**
 * The storage work a committed purge leaves to be done **after** the transaction.
 *
 * Filesystem unlinks are not transactional, so they cannot happen inside one. Collecting
 * them into a plan is what lets the rows, the completion record and the outbox message
 * commit or roll back together, and the bytes go afterwards.
 */
export interface UnlinkPlan {
  /** Objects named by rows this purge removed. */
  readonly keys: readonly string[];
  /** `person-photos/<id>/`, `renders/<id>/`, `exports/<id>/` — §3.3. */
  readonly prefixes: readonly string[];
}

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
 * | `moderation_items` | rows **and** their blurred thumbnails — all four FKs are `SET NULL`, so nothing else would have taken them (§4.29) |
 * | `enquiry_items.note` | her own words about a piece; the commercial columns beside them stay |
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

  /**
   * Requests with no completion row yet, oldest first. `DELETION_BATCH_SIZE` at a time.
   *
   * `failureReason IS NULL` is what separates a *request* from an *attempt*. A failed purge
   * now appends a retryable row — `completedAt = null`, `failureReason` set — and without
   * this predicate each failure would look like a second request for the same subject, so
   * one stuck account would grow to fill the batch by itself.
   */
  async findPending(limit: number = DELETION_BATCH_SIZE): Promise<DeletionLogEntry[]> {
    const requests = await this.deletions.find({
      where: {
        subjectType: DeletionSubject.USER,
        completedAt: IsNull(),
        failureReason: IsNull(),
      },
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

    const { result, plan } = await runInTransaction(
      this.dataSource,
      async (manager: EntityManager): Promise<{ result: AccountPurgeResult; plan: UnlinkPlan }> => {
        const { purged, plan } = await this.purgeAccount(manager, request.subjectId);

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
            // deleted in this same transaction. `recipientUserId` is null for the same
            // reason — a real id would be CASCADE-deleted with the `users` row before the
            // processor ever saw it, taking the confirmation with it.
            //
            // That combination used to be the last copy of her name and email address in
            // the database, and it was permanent: nothing resolves it, `purgeForUser`
            // deletes by `recipientUserId` and so cannot match it, and nothing pruned
            // `SENT` rows. `OutboxProcessor.markSent` now clears `recipientAddress` and
            // `payload` the moment delivery succeeds, so the personal data lives exactly
            // as long as it takes to send one email — and `pruneDelivered` removes the
            // husk afterwards.
            recipientAddress: account.email,
            recipientUserId: null,
            locale: account.locale,
            dedupeKey: `account-deleted:${request.subjectId}`,
          });
        }

        return { result: purged, plan };
      },
      { label: 'retention.executeDeletion' },
    );

    // ---- after `commitTransaction()`, and that is the entire point ----
    //
    // The rows are gone, the completion row is durable, and the confirmation email is in
    // the outbox. Only now are the bytes unlinked.
    //
    // Filesystem unlinks are not transactional. Doing them inside the transaction meant a
    // storage volume that went away on the third of three `deletePrefix` calls left every
    // byte destroyed and — because the transaction rolled back — every row intact: a
    // DEACTIVATED account with a gallery of 404s. The throw then routed to `recordFailure`,
    // which wrote a *completion*, and `findPending` filters on exactly that, so it was
    // never retried either.
    //
    // Ordered this way the worst case is the harmless one. A crash between the commit and
    // the unlink leaves objects whose rows no longer exist — unreachable, because a signed
    // URL is minted from a row — and `OrphanSweepService` reclaims them on its next hourly
    // pass, which is precisely the case §3.5 step 4 exists for.
    await this.unlink(plan, request.subjectId);

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
   * Removes every **row** belonging to one account, inside the caller's transaction, and
   * returns the storage keys the caller must unlink **after the commit**.
   *
   * ### Why the bytes are no longer destroyed in here
   *
   * The original ordering — objects first, then the rows that name them — had a real
   * argument behind it: once a `tryon_results` row is gone, nothing knows which file it
   * pointed at, and a file with no row is invisible to every later sweep. That argument is
   * correct for `PurgeService.purgeOne`, which is retried and whose `storage.delete` is
   * idempotent. It does not transfer here, because here the deletes sit inside a
   * transaction that can roll back — and an unlink cannot.
   *
   * The sweep the argument feared no longer needs the row: `OrphanSweepService` lists
   * `person-photos/<userId>/`, `renders/<userId>/` and `exports/<userId>/` and deletes what
   * has no owning row. After this transaction commits, *everything* under those prefixes is
   * exactly that. So the file with no row is not invisible; it is the sweep's whole
   * purpose.
   *
   * ### The manifest is measured here, not after
   *
   * `head()` is a read and is safe inside the transaction, so the byte count and the A-20
   * verification hash are computed from the set of objects this purge is responsible for
   * and written onto the completion row before it commits. The hash therefore covers what
   * was removed even if the unlink of one of them has to be finished by the sweep.
   *
   * `deletePrefix` on the three prefixes (§3.3) still catches anything a row did not name:
   * an orphan from a failed write, a thumbnail whose row was pruned, every export archive
   * she ever generated (C-39). The per-key list gives an accurate byte count; the prefix
   * drop gives completeness. Both are needed and neither replaces the other.
   */
  async purgeAccount(
    manager: EntityManager,
    userId: string,
  ): Promise<{ purged: AccountPurgeResult; plan: UnlinkPlan }> {
    const photos = await manager.getRepository(PersonPhoto).find({ where: { userId } });
    const renders = await manager.getRepository(TryOnResult).find({
      where: { userId },
      withDeleted: true,
    });
    // §4.29 — all four of `moderation_items`' FKs are `ON DELETE SET NULL`, so deleting
    // her `users` row used to leave the row behind with its columns nulled *except*
    // `blurredThumbnailKey`, which points at a derivative of her photograph. A dangling
    // pointer to an image of a person who no longer exists, in a table the admin queue
    // reads. Read `withDeleted` so a reviewed-and-soft-deleted item's thumbnail goes too.
    const moderationItems = await manager.getRepository(ModerationItem).find({
      where: { userId },
      withDeleted: true,
    });

    const namedKeys = [
      ...photos.flatMap((photo) => [photo.storageKey, photo.blurredThumbnailKey]),
      ...renders.flatMap((render) => [render.storageKey, render.thumbnailKey]),
      ...moderationItems.map((item) => item.blurredThumbnailKey),
    ];

    // Measured, not deleted. See the method comment.
    const measured = await this.measureObjects(namedKeys);

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
      enquiry_item_notes_cleared: await this.clearEnquiryItemNotes(manager, userId),
      moderation_items: await this.deleteWhere(manager, ModerationItem, { userId }),
      tryon_cache: cacheRetired,
    };

    rowsDeleted.users = await this.deleteWhere(manager, User, { id: userId });

    return {
      purged: {
        userId,
        rowsDeleted,
        storageKeysDeleted: measured.keys.length,
        bytesReclaimed: measured.bytesReclaimed,
        verificationHash: measured.verificationHash,
      },
      plan: {
        keys: measured.keys,
        prefixes: [
          StoragePrefixes.personPhotosOfUser(userId),
          StoragePrefixes.rendersOfUser(userId),
          StoragePrefixes.exportsOfUser(userId),
        ],
      },
    };
  }

  /* -----------------------------------------------------------------------------------------
   * Internals
   * -------------------------------------------------------------------------------------- */

  /**
   * Clears the personal columns an enquiry snapshotted (A-21) and keeps the row.
   *
   * See the class comment for why the *row* survives: it is a commercial record between
   * her and the studio, and the studio is a party to it. The message body is not part of
   * that argument and goes: she wrote it, and a sentence about her wedding is as personal
   * as her phone number.
   *
   * `enquiry_items.note` is the same thing one level down, and {@link clearEnquiryItemNotes}
   * is what actually removes it — see there for why it was missed.
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
   * Clears `enquiry_items.note` — her own words about one piece.
   *
   * The commercial-record argument covers the enquiry: what she asked for, which pieces,
   * at what price, on what date. It does **not** cover a free-text note she wrote against
   * a garment ("not sure about the neckline on me") — that is her sentence about her own
   * body, kept only because the row it hangs off is kept, and nothing in A-21 or §4.24
   * asks for it. It was surviving deletion purely because the cascade stopped at
   * `enquiries` and `enquiry_items` is a child table with no `userId` of its own.
   *
   * The commercial columns — rank and the three garment snapshots — stay. Two statements
   * rather than a correlated `UPDATE … WHERE enquiryId IN (SELECT …)` so the operation is
   * expressible through the repository and testable without a database.
   */
  private async clearEnquiryItemNotes(manager: EntityManager, userId: string): Promise<number> {
    const enquiries = await manager.getRepository(Enquiry).find({
      where: { userId },
      withDeleted: true,
      select: { id: true },
    });

    if (enquiries.length === 0) {
      return 0;
    }

    const result = await manager
      .getRepository(EnquiryItem)
      .update({ enquiryId: In(enquiries.map((enquiry) => enquiry.id)) }, { note: null });

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

  /**
   * The manifest: which objects this purge owns, how large they are, and their A-20 hash.
   *
   * `head()` only. Nothing is destroyed here, because "here" is inside a transaction that
   * may still roll back. Keys that no longer exist in storage are excluded, so the hash
   * describes what was actually there to remove.
   */
  private async measureObjects(
    keys: readonly (string | null)[],
  ): Promise<{ keys: string[]; bytesReclaimed: number; verificationHash: string }> {
    const present: string[] = [];
    let bytesReclaimed = 0;

    for (const key of keys) {
      if (key === null || key === '') {
        continue;
      }
      const stored = await this.storage.head(key);
      if (stored !== null) {
        present.push(key);
        bytesReclaimed += stored.byteSize;
      }
    }

    return {
      keys: present,
      bytesReclaimed,
      verificationHash: sha256Hex([...present].sort().join('\n')),
    };
  }

  /**
   * Unlinks the objects the committed purge named, then drops her three prefixes.
   *
   * **Never throws.** The account is already deleted — every row is gone and nothing can
   * reach these bytes, because a signed URL is minted from a row. A storage failure at this
   * point is a reclamation problem, not a privacy one, and turning it into an exception
   * would send `execute()` into `recordFailure` for a purge that succeeded.
   *
   * Whatever is left behind is unreferenced, and unreferenced is exactly what
   * `OrphanSweepService` collects — the failure is logged loudly so an operator knows the
   * volume misbehaved, and the next hourly sweep finishes the job.
   */
  private async unlink(plan: UnlinkPlan, subjectId: string): Promise<void> {
    let removed = 0;
    const failures: string[] = [];

    for (const key of plan.keys) {
      try {
        if (await this.storage.delete(key)) {
          removed += 1;
        }
      } catch (error: unknown) {
        failures.push(key);
        this.logger.error(
          `Could not unlink ${key} for deleted subject ${subjectId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    for (const prefix of plan.prefixes) {
      try {
        removed += await this.storage.deletePrefix(prefix);
      } catch (error: unknown) {
        failures.push(prefix);
        this.logger.error(
          `Could not drop prefix ${prefix} for deleted subject ${subjectId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (failures.length > 0) {
      this.logger.error(
        `${failures.length} storage target(s) survived the purge of subject ${subjectId}. ` +
          'Every row is gone, so nothing is reachable; the orphan sweep will reclaim the ' +
          'bytes on its next pass (§3.5 step 4).',
      );
      return;
    }

    this.logger.debug(`Unlinked ${removed} object(s) for deleted subject ${subjectId}.`);
  }

  /**
   * Records a failed purge as a **retryable** row — `completedAt = null` — until the
   * attempts are spent.
   *
   * ### Why this is no longer a completion
   *
   * It used to write `completedAt = now`, and the argument was about protecting the batch:
   * a cascade that failed once for a reason nobody has looked at will fail again every
   * fifteen minutes while nine other consumers wait past their SLA. True, and the price was
   * far too high. `deletion_log` is what A-20 offers as proof an account is gone, and
   * `findPending` filters on exactly this column — so a completion row for a purge that did
   * not happen made the confirmation record false in both directions at once: it said the
   * deletion finished, and it guaranteed it never would.
   *
   * A failure is now visible (`failureReason` is set, and E-14 still counts it as pending
   * and overdue) and retryable. The batch is protected by {@link DELETION_MAX_ATTEMPTS}
   * instead of by an untrue row: once those are spent the request is written off with a
   * real completion carrying the reason, which stops it consuming the batch and leaves the
   * escalation to a human — which is what the original comment wanted all along.
   */
  private async recordFailure(request: DeletionLogEntry, error: unknown, now: Date): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    const attempts = await this.failedAttemptsFor(request.subjectId);
    const writtenOff = attempts + 1 >= DELETION_MAX_ATTEMPTS;

    this.logger.error(
      `Account deletion failed for subject ${request.subjectId} (A-20, C-38), attempt ` +
        `${attempts + 1} of ${DELETION_MAX_ATTEMPTS}: ${reason}` +
        (writtenOff ? ' — written off; a human must finish it.' : ''),
    );

    try {
      await this.deletions.insert({
        subjectType: DeletionSubject.USER,
        subjectId: request.subjectId,
        userId: request.userId,
        initiatedBy: request.initiatedBy,
        actorId: request.actorId,
        requestedAt: request.requestedAt,
        // `null` keeps the request in `findPending`, so the next sweep tries again.
        completedAt: writtenOff ? now : null,
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
        metadata: { subjectId: request.subjectId, reason, attempt: attempts + 1, writtenOff },
      }),
    );
  }

  /** How many failed attempts this subject has already accumulated. */
  private async failedAttemptsFor(subjectId: string): Promise<number> {
    return this.deletions.count({
      where: {
        subjectType: DeletionSubject.USER,
        subjectId,
        failureReason: Not(IsNull()),
      },
    });
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
