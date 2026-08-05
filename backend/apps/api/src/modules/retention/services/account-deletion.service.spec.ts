/**
 * PRD A-20, C-38, §9.3 — deletion, executed.
 *
 * Three claims are made to a consumer and to a regulator, and all three are asserted
 * here:
 *
 *  1. **it completes inside the SLA** — the request row is picked up by the sweep and
 *     paired with a completion row carrying a real `completedAt`;
 *  2. **it leaves nothing behind** — no photo, no render, no shortlist, no share link,
 *     no in-app notification, and no storage object under her prefixes;
 *  3. **completion is appended, never updated** — `deletion_log` carries
 *     `no_update_deletion_log`, so an `UPDATE` on it silently does nothing. A design
 *     that "completed" a request by updating it would leave every request looking
 *     outstanding forever, and the E-14 alert would fire on a system that was working.
 */
import { type ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Locale, Role, UserStatus, type ICurrentUser } from '@library/common';
import type { StorageService, StoredObject } from '@library/storage';

import { EnquiryItem } from '@api/modules/enquiries/entities/enquiry-item.entity';
import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { EnquiryStatus } from '@api/modules/enquiries/enums/enquiry-status.enum';
import { ModerationItem } from '@api/modules/moderation/entities/moderation-item.entity';
import { ModerationSource } from '@api/modules/moderation/enums/moderation-source.enum';
import { ModerationState } from '@api/modules/moderation/enums/moderation-state.enum';
import type { NotificationsInboxService } from '@api/modules/notifications/services/notifications-inbox.service';
import type { OutboxService } from '@api/modules/notifications/services/outbox.service';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { ShareLink } from '@api/modules/share/entities/share-link.entity';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';
import { TryOnJob } from '@api/modules/tryon/entities/tryon-job.entity';
import { User } from '@api/modules/users/entities/user.entity';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { DELETION_MAX_ATTEMPTS } from '../constants/retention.constants';
import { DeletionLogEntry } from '../entities/deletion-log-entry.entity';
import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

import { AccountDeletionService } from './account-deletion.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { DataSource, EntityManager } from 'typeorm';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const REQUESTED_AT = new Date('2026-08-15T09:00:00.000Z');
const CONSUMER_ID = 'aaaaaaaa-1111-4222-8333-444455556666';

const CONSUMER: ICurrentUser = {
  id: CONSUMER_ID,
  role: Role.CONSUMER,
  email: 'ayesha@example.com',
  name: 'Ayesha Khan',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: REQUESTED_AT,
  phoneVerifiedAt: REQUESTED_AT,
  sessionId: 'bbbbbbbb-1111-4222-8333-444455556666',
  locale: Locale.EN,
};

let sequence = 0;
const nextId = (prefix: string): string =>
  `${prefix}0000000-0000-4000-8000-${String((sequence += 1)).padStart(12, '0')}`;

function buildAccount(): User {
  return Object.assign(new User(), {
    id: CONSUMER_ID,
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
    deletedAt: null,
    role: Role.CONSUMER,
    email: CONSUMER.email,
    emailVerifiedAt: REQUESTED_AT,
    passwordHash: 'argon2id$…',
    name: CONSUMER.name,
    phone: '+923001234567',
    phoneVerifiedAt: REQUESTED_AT,
    twofaSecret: null,
    twofaEnabledAt: null,
    twofaRecoveryCodes: null,
    status: UserStatus.ACTIVE,
    suspendedReason: null,
    suspendedAt: null,
    invitedBy: null,
    lastLoginAt: REQUESTED_AT,
    lastActiveAt: REQUESTED_AT,
    failedLoginCount: 0,
    lockedUntil: null,
    locale: Locale.EN,
    deletionRequestedAt: null,
  });
}

function buildPhoto(): PersonPhoto {
  const id = nextId('4');
  return Object.assign(new PersonPhoto(), {
    id,
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
    deletedAt: null,
    userId: CONSUMER_ID,
    storageKey: `person-photos/${CONSUMER_ID}/${id}.jpg`,
    blurredThumbnailKey: `thumbnails/person-blurred/${id}-160.webp`,
    hash: 'b'.repeat(64),
    isActive: true,
    label: 'daylight',
    uploadedAt: REQUESTED_AT,
    purgeAfter: new Date('2026-09-14T00:00:00.000Z'),
    moderationState: PhotoModerationState.APPROVED,
    width: 1200,
    height: 1600,
    byteSize: 400_000,
    mimeType: 'image/jpeg',
  });
}

function buildRender(): TryOnResult {
  const id = nextId('5');
  return Object.assign(new TryOnResult(), {
    id,
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
    deletedAt: null,
    jobId: null,
    userId: CONSUMER_ID,
    garmentId: null,
    personPhotoId: null,
    storageKey: `renders/${CONSUMER_ID}/${id}.png`,
    thumbnailKey: `thumbnails/render/${id}-320.webp`,
    cacheKey: `${id.replace(/-/g, '')}`.padEnd(64, 'f'),
    garmentTitleSnapshot: 'Anarkali in ivory',
    garmentCategorySnapshot: 'Bridal',
    garmentPriceSnapshot: null,
    garmentCurrencySnapshot: 'PKR',
    personPhotoLabelSnapshot: 'daylight',
    isTestRender: false,
    width: 1024,
    height: 1536,
    byteSize: 900_000,
    marketingOptInAt: null,
  });
}

interface Harness {
  readonly service: AccountDeletionService;
  readonly repositories: Map<unknown, InMemoryRepository<{ id: string }>>;
  readonly deletionLog: InMemoryRepository<DeletionLogEntry>;
  readonly users: InMemoryRepository<User>;
  readonly storage: jest.Mocked<StorageService>;
  readonly outbox: jest.Mocked<OutboxService>;
  readonly inbox: jest.Mocked<NotificationsInboxService>;
  readonly deletedKeys: string[];
  readonly deletedPrefixes: string[];
}

function build(): Harness {
  const account = buildAccount();
  const photo = buildPhoto();
  const renders = [buildRender(), buildRender()];

  const repositories = new Map<unknown, InMemoryRepository<{ id: string }>>();
  const registry = <T extends { id: string }>(
    entity: unknown,
    rows: readonly T[],
  ): InMemoryRepository<T> => {
    const repository = createInMemoryRepository<T>({ rows });
    repositories.set(entity, repository as unknown as InMemoryRepository<{ id: string }>);
    return repository;
  };

  const users = registry(User, [account]);
  registry(PersonPhoto, [photo]);
  registry(TryOnResult, renders);
  registry(ShortlistItem, [
    Object.assign(new ShortlistItem(), {
      id: nextId('6'),
      createdAt: REQUESTED_AT,
      updatedAt: REQUESTED_AT,
      deletedAt: null,
      userId: CONSUMER_ID,
      garmentId: nextId('7'),
      verdict: Verdict.LOVE_IT,
      rank: 1,
      rejectReason: null,
      note: null,
      latestResultId: null,
      verdictAt: REQUESTED_AT,
    }),
  ]);
  registry(ShareLink, [
    Object.assign(new ShareLink(), {
      id: nextId('8'),
      createdAt: REQUESTED_AT,
      updatedAt: REQUESTED_AT,
      deletedAt: null,
      userId: CONSUMER_ID,
      tokenHash: 'e'.repeat(64),
      label: 'Ammi',
      expiresAt: new Date('2026-09-14T00:00:00.000Z'),
      revokedAt: null,
      viewCount: 4,
      lastViewedAt: REQUESTED_AT,
    }),
  ]);
  registry(TryOnJob, [
    Object.assign(new TryOnJob(), {
      id: nextId('9'),
      createdAt: REQUESTED_AT,
      updatedAt: REQUESTED_AT,
      deletedAt: null,
      userId: CONSUMER_ID,
      status: 'SUCCEEDED',
      idempotencyKey: 'k-1',
      origin: 'CONSUMER',
      isTestRender: false,
      cacheHit: false,
      attempts: 1,
    }),
  ]);
  registry(TryOnCache, [
    Object.assign(new TryOnCache(), {
      id: nextId('a'),
      createdAt: REQUESTED_AT,
      updatedAt: REQUESTED_AT,
      deletedAt: null,
      cacheKey: renders[0].cacheKey,
      garmentSourceHash: 'f'.repeat(64),
      personPhotoHash: 'b'.repeat(64),
      apiVersion: '2026-08-01',
      garmentId: null,
      // The canonical copy is *her* render — the case §3.7 describes.
      storageKey: renders[0].storageKey,
      width: 1024,
      height: 1536,
      hitCount: 3,
      lastHitAt: REQUESTED_AT,
    }),
  ]);
  const enquiry = Object.assign(new Enquiry(), {
    id: nextId('b'),
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
    deletedAt: null,
    reference: 'ENQ-2026-000137',
    userId: CONSUMER_ID,
    message: 'I would love to see the ivory anarkali.',
    status: EnquiryStatus.NEW,
    lostReason: null,
    eventDate: null,
    eventType: null,
    budgetBand: null,
    contactName: 'Ayesha Khan',
    contactEmail: 'ayesha@example.com',
    contactPhone: '+923001234567',
    firstRespondedAt: null,
    closedAt: null,
    assignedTo: null,
    totalValueSnapshot: null,
  });
  registry(Enquiry, [enquiry]);

  // Her own words about one piece. §4.24 keeps the *commercial* columns; this is not one
  // of them, and it survived deletion only because `enquiry_items` has no `userId`.
  registry(EnquiryItem, [
    Object.assign(new EnquiryItem(), {
      id: nextId('d'),
      createdAt: REQUESTED_AT,
      updatedAt: REQUESTED_AT,
      deletedAt: null,
      enquiryId: enquiry.id,
      garmentId: nextId('7'),
      resultId: null,
      rank: 1,
      note: 'Not sure about the neckline on me.',
      garmentTitleSnapshot: 'Anarkali in ivory',
      garmentSkuSnapshot: 'AN-IVY-01',
      garmentPriceSnapshot: null,
    }),
  ]);

  // §4.29 — all four FKs are SET NULL, so nothing else in the cascade would ever take
  // this row, and `blurredThumbnailKey` points at a derivative of her photograph.
  registry(ModerationItem, [
    Object.assign(new ModerationItem(), {
      id: nextId('e'),
      createdAt: REQUESTED_AT,
      updatedAt: REQUESTED_AT,
      deletedAt: null,
      personPhotoId: photo.id,
      userId: CONSUMER_ID,
      jobId: null,
      source: ModerationSource.UPSTREAM,
      reasonCode: 'NUDITY',
      state: ModerationState.APPROVED,
      blurredThumbnailKey: `thumbnails/person-blurred/${nextId('f')}-160.webp`,
      reviewedBy: null,
      reviewedAt: REQUESTED_AT,
      decisionNote: null,
    }),
  ]);

  const deletionLog = registry(DeletionLogEntry, [
    Object.assign(new DeletionLogEntry(), {
      id: nextId('c'),
      createdAt: REQUESTED_AT,
      subjectType: DeletionSubject.USER,
      subjectId: CONSUMER_ID,
      userId: CONSUMER_ID,
      initiatedBy: DeletionInitiator.CONSUMER,
      actorId: CONSUMER_ID,
      requestedAt: REQUESTED_AT,
      completedAt: null,
      rowsDeleted: {},
      storageKeysDeleted: 0,
      bytesReclaimed: '0',
      verificationHash: '0'.repeat(64),
      failureReason: null,
    }),
  ]);

  const deletedKeys: string[] = [];
  const deletedPrefixes: string[] = [];
  const storage = createMock<StorageService>(['head', 'delete', 'deletePrefix']);
  storage.head.mockImplementation(async (key: string): Promise<StoredObject | null> => ({
    key,
    byteSize: 1_000,
    contentType: 'application/octet-stream',
    etag: 'd'.repeat(64),
    lastModified: NOW,
  }));
  storage.delete.mockImplementation(async (key: string) => {
    deletedKeys.push(key);
    return true;
  });
  storage.deletePrefix.mockImplementation(async (prefix: string) => {
    deletedPrefixes.push(prefix);
    return 0;
  });

  const outbox = createMock<OutboxService>(['enqueueWithin', 'enqueue']);
  outbox.enqueueWithin.mockResolvedValue('outbox-1');

  const inbox = createMock<NotificationsInboxService>(['purgeForUser']);
  inbox.purgeForUser.mockResolvedValue(2);

  const manager = {
    getRepository: (entity: unknown) => {
      const repository = repositories.get(entity);
      if (repository === undefined) {
        throw new Error(`Unexpected repository requested: ${String(entity)}`);
      }
      return repository;
    },
  } as unknown as EntityManager;

  /**
   * **A query runner that actually rolls back.**
   *
   * The usual fixture's `rollbackTransaction` is a no-op, and for most services that is the
   * right fidelity. Not for this one. The whole finding here is about what survives a
   * rollback — the transaction destroyed every byte, then rolled back, and every row came
   * back with its storage key pointing at nothing. Against a double where rollback does
   * nothing, that failure mode is not merely untested, it is *unrepresentable*.
   *
   * So this one snapshots each repository on `startTransaction` and restores it on
   * `rollbackTransaction`. Rows are shallow-cloned, because `update()` mutates in place and
   * a snapshot of references would restore the mutated objects.
   */
  const snapshots = new Map<unknown, { id: string }[]>();
  const queryRunner = {
    manager,
    isTransactionActive: false,
    connect: async (): Promise<void> => undefined,
    startTransaction: async (): Promise<void> => {
      snapshots.clear();
      for (const [entity, repository] of repositories) {
        snapshots.set(
          entity,
          repository.$rows.map((row) => ({ ...row })),
        );
      }
      queryRunner.isTransactionActive = true;
    },
    commitTransaction: async (): Promise<void> => {
      snapshots.clear();
      queryRunner.isTransactionActive = false;
    },
    rollbackTransaction: async (): Promise<void> => {
      for (const [entity, rows] of snapshots) {
        repositories.get(entity)?.$seed(rows);
      }
      snapshots.clear();
      queryRunner.isTransactionActive = false;
    },
    release: async (): Promise<void> => undefined,
  };

  const dataSource = {
    createQueryRunner: () => queryRunner,
  } as unknown as DataSource;

  const config = createMock<ConfigService>(['get']);
  config.get.mockReturnValue(24);

  const service = new AccountDeletionService(
    deletionLog,
    users,
    dataSource,
    storage,
    outbox,
    inbox,
    config,
    new EventEmitter2(),
  );

  return {
    service,
    repositories,
    deletionLog,
    users,
    storage,
    outbox,
    inbox,
    deletedKeys,
    deletedPrefixes,
  };
}

const rowsOf = (harness: Harness, entity: unknown): { id: string }[] =>
  harness.repositories.get(entity)?.$rows ?? [];

describe('AccountDeletionService', () => {
  describe('C-38 — her own request', () => {
    it('is immediate from her view: a receipt, a deactivated account, a durable row', async () => {
      const harness = build();

      const receipt = await harness.service.requestSelfDeletion(CONSUMER);

      expect(receipt).toMatchObject({
        subjectType: DeletionSubject.USER,
        subjectId: CONSUMER_ID,
        initiatedBy: DeletionInitiator.CONSUMER,
        // Never optimistic: the purge has not run, so this is null.
        completedAt: null,
      });
      expect(receipt.dueBy.getTime() - receipt.requestedAt.getTime()).toBe(24 * 60 * 60 * 1000);
      expect(harness.users.$rows[0].status).toBe(UserStatus.DEACTIVATED);
      expect(harness.users.$rows[0].deletionRequestedAt).not.toBeNull();
    });

    it('refuses a second request while one is in progress', async () => {
      const harness = build();
      harness.users.$rows[0].deletionRequestedAt = REQUESTED_AT;

      await expect(harness.service.requestSelfDeletion(CONSUMER)).rejects.toMatchObject({
        errorCode: 'DELETION_IN_PROGRESS',
      });
    });
  });

  describe('the sweep leaves nothing behind (A-20, §9.3)', () => {
    it('removes every row belonging to the account', async () => {
      const harness = build();

      const { completed, failed } = await harness.service.sweep(NOW);

      expect({ completed, failed }).toEqual({ completed: 1, failed: 0 });

      expect(rowsOf(harness, PersonPhoto)).toHaveLength(0);
      expect(rowsOf(harness, TryOnResult)).toHaveLength(0);
      expect(rowsOf(harness, ShortlistItem)).toHaveLength(0);
      expect(rowsOf(harness, ShareLink)).toHaveLength(0);
      expect(rowsOf(harness, TryOnJob)).toHaveLength(0);
      expect(rowsOf(harness, User)).toHaveLength(0);
      expect(harness.inbox.purgeForUser).toHaveBeenCalledWith(CONSUMER_ID);
    });

    it('removes every storage object she owned, by key and by prefix (§3.3)', async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      // Named keys: her photograph, its blurred derivative, both renders and their
      // thumbnails, and the blurred thumbnail her `moderation_items` row named.
      expect(harness.deletedKeys).toHaveLength(7);
      expect(harness.deletedKeys.some((key) => key.startsWith('person-photos/'))).toBe(true);
      expect(harness.deletedKeys.some((key) => key.startsWith('renders/'))).toBe(true);

      // And the prefixes, which catch anything no row named — orphans from a failed
      // write, and every export archive she ever generated (C-39).
      expect(harness.deletedPrefixes).toEqual([
        `person-photos/${CONSUMER_ID}/`,
        `renders/${CONSUMER_ID}/`,
        `exports/${CONSUMER_ID}/`,
      ]);
    });

    it('retires the cache row that pointed at her render, so nothing dangles (§3.7)', async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      expect(rowsOf(harness, TryOnCache)).toHaveLength(0);
    });

    it("anonymises her enquiries rather than deleting the studio's commercial record", async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      const enquiries = harness.repositories.get(Enquiry)?.$rows ?? [];
      expect(enquiries).toHaveLength(1);
      expect(enquiries[0]).toMatchObject({
        contactName: 'Deleted account',
        contactEmail: '',
        contactPhone: '',
        message: '',
      });
      // The reference survives, because the studio's side of a conversation is the
      // studio's (A-21). Nothing personal does.
      expect(JSON.stringify(enquiries[0])).not.toContain('ayesha@example.com');
      expect(JSON.stringify(enquiries[0])).not.toContain('Ayesha Khan');
      expect(JSON.stringify(enquiries[0])).not.toContain('+923001234567');
    });

    /**
     * The commercial-record argument covers the enquiry. It does not cover a free-text
     * note she wrote against one piece — her own sentence about her own body — which was
     * surviving deletion only because `enquiry_items` is a child table with no `userId`
     * and the cascade stopped at `enquiries`.
     */
    it('clears her per-item notes while keeping the commercial columns (§4.24)', async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      const items = harness.repositories.get(EnquiryItem)?.$rows ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        note: null,
        rank: 1,
        garmentTitleSnapshot: 'Anarkali in ivory',
        garmentSkuSnapshot: 'AN-IVY-01',
      });
      expect(JSON.stringify(items[0])).not.toContain('neckline');
    });

    /**
     * §4.29 — all four of `moderation_items`' FKs are `ON DELETE SET NULL`, so the
     * database cascade could never take the row, and nothing in `purgeAccount` did
     * either. What survived was a row whose `blurredThumbnailKey` pointed at a
     * derivative of the photograph of a person who no longer exists.
     */
    it('deletes her moderation items and the blurred thumbnails they name (§4.29)', async () => {
      const harness = build();
      const item = harness.repositories.get(ModerationItem)?.$rows[0];
      const blurredKey = (item as unknown as { blurredThumbnailKey: string }).blurredThumbnailKey;

      await harness.service.sweep(NOW);

      expect(rowsOf(harness, ModerationItem)).toHaveLength(0);
      expect(harness.deletedKeys).toContain(blurredKey);
    });
  });

  describe('the completion record (§4.31)', () => {
    it('is appended, never an update — deletion_log carries no_update_deletion_log', async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      // Two rows for one subject: the request and its completion. An `UPDATE` on this
      // table silently does nothing, so a design that completed by updating would
      // leave every request looking outstanding forever.
      expect(harness.deletionLog.$rows).toHaveLength(2);
      expect(harness.deletionLog.update).not.toHaveBeenCalled();

      const [request, completion] = harness.deletionLog.$rows;
      expect(request.completedAt).toBeNull();
      expect(completion.completedAt).toEqual(NOW);
      expect(completion.subjectId).toBe(CONSUMER_ID);
      expect(completion.requestedAt).toEqual(REQUESTED_AT);
    });

    it('carries a real manifest and a verification hash (§9.3)', async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      const completion = harness.deletionLog.$rows[1];
      expect(completion.rowsDeleted).toMatchObject({
        person_photos: 1,
        tryon_results: 2,
        shortlist_items: 1,
        share_links: 1,
        moderation_items: 1,
        enquiry_item_notes_cleared: 1,
        users: 1,
      });
      expect(completion.storageKeysDeleted).toBe(7);
      expect(completion.verificationHash).toMatch(/^[0-9a-f]{64}$/);
      expect(completion.failureReason).toBeNull();
    });

    it('completes well inside the 24-hour SLA (A-20, C-38)', async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      const completion = harness.deletionLog.$rows[1];
      const elapsedHours =
        (completion.completedAt!.getTime() - completion.requestedAt.getTime()) / 3_600_000;
      expect(elapsedHours).toBeLessThan(24);
    });

    it('does not pick the request up again once it is complete', async () => {
      const harness = build();
      await harness.service.sweep(NOW);

      const second = await harness.service.sweep(NOW);

      expect(second).toEqual({ completed: 0, failed: 0 });
      expect(harness.deletionLog.$rows).toHaveLength(2);
    });
  });

  describe('C-38 — she is told', () => {
    it('queues the confirmation inside the same transaction, with the address on the row', async () => {
      const harness = build();

      await harness.service.sweep(NOW);

      expect(harness.outbox.enqueueWithin).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          template: 'ACCOUNT_DELETION_CONFIRMED',
          // The one place an address is stored rather than resolved at delivery time:
          // the account it would be resolved from is deleted in this transaction.
          recipientAddress: 'ayesha@example.com',
          recipientUserId: null,
        }),
      );
    });
  });

  /* -----------------------------------------------------------------------------------------
   * The bytes go after the commit, and a failure is retryable
   * -------------------------------------------------------------------------------------- */

  describe('unreachable storage cannot destroy the account and record it as done', () => {
    it('never unlinks a byte before the transaction commits', async () => {
      const harness = build();
      const orderOfEvents: string[] = [];

      harness.storage.delete.mockImplementation(async (key: string) => {
        orderOfEvents.push(`delete:${key}`);
        return true;
      });
      harness.storage.deletePrefix.mockImplementation(async (prefix: string) => {
        orderOfEvents.push(`deletePrefix:${prefix}`);
        return 0;
      });
      const insert = harness.deletionLog.insert.bind(harness.deletionLog);
      harness.deletionLog.insert = jest.fn(async (row: Parameters<typeof insert>[0]) => {
        orderOfEvents.push('completionRow');
        return insert(row);
      });

      await harness.service.sweep(NOW);

      // The completion row — which commits with the cascade — lands before the first
      // unlink. Reversed, a storage failure destroys every byte and then rolls every row
      // back, leaving a DEACTIVATED account with a gallery of 404s.
      expect(orderOfEvents[0]).toBe('completionRow');
      expect(orderOfEvents.slice(1).every((event) => event.startsWith('delete'))).toBe(true);
    });

    it('a storage volume that dies mid-purge leaves the rows intact and nothing unlinked', async () => {
      const harness = build();
      // The cascade itself fails — the case that must roll back cleanly.
      harness.inbox.purgeForUser.mockRejectedValue(new Error('the database went away'));

      const { completed, failed } = await harness.service.sweep(NOW);

      expect({ completed, failed }).toEqual({ completed: 0, failed: 1 });
      // Rolled back — and this fixture's query runner really does roll back, so the
      // assertion means something.
      expect(harness.users.$rows).toHaveLength(1);
      expect(rowsOf(harness, PersonPhoto)).toHaveLength(1);
      // …and, crucially, her photographs are still *there*. The unlinks never ran, because
      // they no longer run inside the transaction.
      expect(harness.deletedKeys).toEqual([]);
      expect(harness.deletedPrefixes).toEqual([]);
    });

    it('records a failure as retryable, so the next sweep tries again', async () => {
      const harness = build();
      harness.inbox.purgeForUser.mockRejectedValue(new Error('storage volume is unreachable'));

      const { completed, failed } = await harness.service.sweep(NOW);

      expect({ completed, failed }).toEqual({ completed: 0, failed: 1 });
      expect(harness.deletionLog.$rows).toHaveLength(2);

      const failure = harness.deletionLog.$rows[1];
      expect(failure.failureReason).toContain('storage volume is unreachable');
      // The finding in one assertion. A completion row here would be false in both
      // directions: it claims the account is gone, and `findPending` filters on exactly
      // this column, so the request would never be retried.
      expect(failure.completedAt).toBeNull();
      await expect(harness.service.findPending()).resolves.toHaveLength(1);
    });

    it('retries until the attempts are spent, then writes the request off', async () => {
      const harness = build();
      harness.inbox.purgeForUser.mockRejectedValue(new Error('still unreachable'));

      for (let attempt = 0; attempt < DELETION_MAX_ATTEMPTS; attempt += 1) {
        await harness.service.sweep(NOW);
      }

      // Written off with a real completion, so it stops eating the batch while nine other
      // consumers wait past their SLA — the concern the original comment had, addressed
      // with a bound instead of with an untrue row.
      const last = harness.deletionLog.$rows[harness.deletionLog.$rows.length - 1];
      expect(last.completedAt).toEqual(NOW);
      expect(last.failureReason).toContain('still unreachable');
      await expect(harness.service.findPending()).resolves.toHaveLength(0);
    });

    it('completes the purge even when the unlink afterwards fails', async () => {
      const harness = build();
      harness.storage.deletePrefix.mockRejectedValue(new Error('storage volume is unreachable'));

      const { completed, failed } = await harness.service.sweep(NOW);

      // The account really is deleted: every row is gone, so nothing can reach the
      // residue — a signed URL is minted from a row. What survives is unreferenced, which
      // is precisely what `OrphanSweepService` collects (§3.5 step 4).
      expect({ completed, failed }).toEqual({ completed: 1, failed: 0 });
      expect(harness.users.$rows).toHaveLength(0);
      expect(rowsOf(harness, PersonPhoto)).toHaveLength(0);

      const completion = harness.deletionLog.$rows[1];
      expect(completion.completedAt).toEqual(NOW);
      expect(completion.failureReason).toBeNull();
    });
  });
});
