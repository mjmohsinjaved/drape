/**
 * PRD C-11 … C-16, C-28, C-38, S-10 · ARCHITECTURE §5.9, §4.16.
 *
 * Four properties, in the order of how much damage getting them wrong would do:
 *
 *  1. **A render survives deletion of the photo it came from** (C-28). The delete path
 *     must not touch `tryon_results` at all; the `ON DELETE SET NULL` foreign key does
 *     the rest.
 *  2. **Exactly one active photo**, including when two devices activate different
 *     photos at once (C-16).
 *  3. **A signed URL is scoped to its owner** and cannot be redeemed by another
 *     account (§3.4, §9.2). Asserted against the real `SignedUrlService`, not a mock.
 *  4. **Ownership is a predicate, never an inference from an id** (§9.2).
 */
import { type ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  ErrorCode,
  Locale,
  MetricsService,
  Role,
  UserStatus,
  type ICurrentUser,
} from '@library/common';
import {
  SignedUrlService,
  StoragePrefixes,
  type ImageService,
  type StorageConfig,
  type StorageService,
  type StoredObject,
} from '@library/storage';

import { AUDIT_RECORD_EVENT } from '@api/modules/audit/events/audit.event';
import { type ConsentsService } from '@api/modules/consents/services/consents.service';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { DeletionLogEntry } from '@api/modules/retention/entities/deletion-log-entry.entity';
import { DeletionSubject } from '@api/modules/retention/enums/deletion-subject.enum';
import { RetentionPolicy } from '@api/modules/retention/services/retention-policy.service';
import { type SettingsService } from '@api/modules/settings';
import { User } from '@api/modules/users/entities/user.entity';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { PersonPhoto } from '../entities/person-photo.entity';
import { PhotoModerationState } from '../enums/photo-moderation-state.enum';
import { PERSON_PHOTO_EVENTS, type PersonPhotoRemovedEvent } from '../events/person-photo.events';

import { PersonPhotosService } from './person-photos.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { DataSource, EntityManager, Repository } from 'typeorm';

const OWNER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const PHOTO_A = 'aaaaaaaa-1111-4222-8333-444455556666';
const PHOTO_B = 'bbbbbbbb-1111-4222-8333-444455556666';
const NOW = new Date('2026-08-15T12:00:00.000Z');

const CONSUMER: ICurrentUser = {
  id: OWNER,
  role: Role.CONSUMER,
  email: 'farida@example.com',
  name: 'Farida',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: NOW,
  phoneVerifiedAt: NOW,
  sessionId: 'dddddddd-1111-4222-8333-444455556666',
  locale: Locale.EN,
};

function photoKey(userId: string, name: string): string {
  return `${StoragePrefixes.personPhotosOfUser(userId)}${name}.jpg`;
}

function buildPhoto(overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  const userId = overrides.userId ?? OWNER;
  return Object.assign(new PersonPhoto(), {
    id: PHOTO_A,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    userId,
    storageKey: photoKey(userId, 'photo-a'),
    blurredThumbnailKey: 'thumbnails/person-blurred/cccccccc-1111-4222-8333-444455556666-160.webp',
    hash: 'a'.repeat(64),
    isActive: true,
    label: 'daylight',
    uploadedAt: NOW,
    purgeAfter: new Date('2026-09-14T12:00:00.000Z'),
    moderationState: PhotoModerationState.APPROVED,
    width: 1080,
    height: 1620,
    byteSize: 842_133,
    mimeType: 'image/jpeg',
    ...overrides,
  });
}

function buildRender(overrides: Partial<TryOnResult> = {}): TryOnResult {
  return Object.assign(new TryOnResult(), {
    id: 'eeeeeeee-1111-4222-8333-444455556666',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    jobId: null,
    userId: OWNER,
    garmentId: null,
    personPhotoId: PHOTO_A,
    storageKey: `renders/${OWNER}/ffffffff-1111-4222-8333-444455556666.png`,
    thumbnailKey: null,
    cacheKey: 'c'.repeat(64),
    garmentTitleSnapshot: 'Zarrin Bridal Lehenga',
    garmentCategorySnapshot: 'Bridal',
    garmentPriceSnapshot: null,
    garmentCurrencySnapshot: 'PKR',
    personPhotoLabelSnapshot: 'daylight',
    isTestRender: false,
    width: 1024,
    height: 1536,
    byteSize: 1_000_000,
    marketingOptInAt: null,
    ...overrides,
  });
}

function storedObject(key: string): StoredObject {
  return {
    key,
    byteSize: 842_133,
    contentType: 'image/jpeg',
    etag: 'f'.repeat(64),
    lastModified: NOW,
  };
}

interface TransactionState {
  started: number;
  committed: number;
  rolledBack: number;
}

interface Harness {
  service: PersonPhotosService;
  photos: InMemoryRepository<PersonPhoto>;
  renders: InMemoryRepository<TryOnResult>;
  deletionLog: InMemoryRepository<DeletionLogEntry>;
  storage: jest.Mocked<StorageService>;
  consents: jest.Mocked<ConsentsService>;
  events: EventEmitter2;
  /** Every `person_photo.removed` payload the service emitted, in order. */
  removed: PersonPhotoRemovedEvent[];
  transactions: TransactionState;
  /** Entity classes the service asked the transactional manager for. */
  repositoriesTouched: unknown[];
  /** Deltas to `isActive` that would have violated `UQ_person_photos_active`. */
  uniqueViolations: number;
}

function build(
  options: {
    rows?: readonly PersonPhoto[];
    renders?: readonly TryOnResult[];
    maxPhotos?: number;
    serialise?: boolean;
  } = {},
): Harness {
  const photos = createInMemoryRepository<PersonPhoto>({ rows: options.rows ?? [] });
  const renders = createInMemoryRepository<TryOnResult>({ rows: options.renders ?? [] });
  const deletionLog = createInMemoryRepository<DeletionLogEntry>();

  const uniqueViolationCounter = { count: 0 };

  /**
   * The two database behaviours §4.16 and §4.18 rely on, modelled so the test can see
   * them. Neither is application code: the partial unique index and the `SET NULL`
   * foreign key are declared in the migration. What the test proves is that the
   * *service* works correctly given them — that it demotes before it promotes, and
   * that it never reaches into `tryon_results` itself.
   */
  const realUpdate = photos.update.bind(photos);
  photos.update = jest.fn(async (criteria: unknown, partial: Partial<PersonPhoto>) => {
    const result = await (realUpdate as (a: unknown, b: unknown) => Promise<unknown>)(
      criteria,
      partial,
    );
    const activePerUser = new Map<string, number>();
    for (const row of photos.$rows) {
      if (row.isActive && row.deletedAt === null) {
        activePerUser.set(row.userId, (activePerUser.get(row.userId) ?? 0) + 1);
      }
    }
    for (const count of activePerUser.values()) {
      if (count > 1) {
        uniqueViolationCounter.count += 1;
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint: 'UQ_person_photos_active',
        });
      }
    }
    return result;
  }) as typeof photos.update;

  const realDelete = photos.delete.bind(photos);
  photos.delete = jest.fn(async (criteria: unknown) => {
    const doomed = photos.$rows.filter((row) =>
      typeof criteria === 'object' && criteria !== null
        ? Object.entries(criteria).every(
            ([key, value]) => (row as unknown as Record<string, unknown>)[key] === value,
          )
        : row.id === criteria,
    );
    const result = await (
      realDelete as (a: unknown) => Promise<{ affected: number; raw: unknown }>
    )(criteria);
    // FK_tryon_results_personPhotoId ON DELETE SET NULL (§4.18).
    for (const photo of doomed) {
      for (const render of renders.$rows) {
        if (render.personPhotoId === photo.id) {
          render.personPhotoId = null;
        }
      }
    }
    return result;
  }) as typeof photos.delete;

  const transactions: TransactionState = { started: 0, committed: 0, rolledBack: 0 };
  const repositoriesTouched: unknown[] = [];

  const manager = {
    getRepository: (entity: unknown): unknown => {
      repositoriesTouched.push(entity);
      if (entity === PersonPhoto) {
        return photos;
      }
      if (entity === DeletionLogEntry) {
        return deletionLog;
      }
      if (entity === TryOnResult) {
        return renders;
      }
      throw new Error(`Unexpected repository requested: ${String(entity)}`);
    },
  } as unknown as EntityManager;

  let chain: Promise<void> = Promise.resolve();

  const dataSource = {
    createQueryRunner: (): unknown => {
      let active = false;
      let releaseLock: (() => void) | null = null;
      return {
        manager,
        get isTransactionActive(): boolean {
          return active;
        },
        connect: async (): Promise<void> => Promise.resolve(),
        startTransaction: async (): Promise<void> => {
          if (options.serialise === true) {
            const previous = chain;
            chain = new Promise<void>((resolve) => {
              releaseLock = resolve;
            });
            await previous;
          }
          transactions.started += 1;
          active = true;
        },
        commitTransaction: async (): Promise<void> => {
          transactions.committed += 1;
          active = false;
        },
        rollbackTransaction: async (): Promise<void> => {
          transactions.rolledBack += 1;
          active = false;
        },
        release: async (): Promise<void> => {
          releaseLock?.();
          releaseLock = null;
        },
      };
    },
  } as unknown as DataSource;

  const storage = createMock<StorageService>(['head', 'getBuffer', 'put', 'delete', 'signedUrl']);
  storage.head.mockImplementation((key) => Promise.resolve(storedObject(key)));
  storage.getBuffer.mockResolvedValue(Buffer.from('jpeg-bytes'));
  storage.put.mockImplementation((key) =>
    Promise.resolve({ key, size: 20_000, sha256: 'b'.repeat(64), mimeType: 'image/webp' }),
  );
  storage.delete.mockResolvedValue(true);
  storage.signedUrl.mockImplementation(
    (key, subject) => `https://api.test/api/v1/files/${key}#sub=${subject ?? ''}`,
  );

  const imageProcessor = createMock<ImageService>(['metadata', 'toBlurredModerationThumbnail']);
  imageProcessor.metadata.mockResolvedValue({
    width: 1080,
    height: 1620,
    format: 'jpeg',
    byteSize: 842_133,
    hasAlpha: false,
    orientation: 1,
  });
  imageProcessor.toBlurredModerationThumbnail.mockResolvedValue(Buffer.from('webp'));

  const settings = createMock<SettingsService>(['getNumber']);
  settings.getNumber.mockResolvedValue(options.maxPhotos ?? 5);

  const consents = createMock<ConsentsService>(['assertConsentIsCurrent']);
  consents.assertConsentIsCurrent.mockResolvedValue(undefined);

  const config = createMock<ConfigService>(['get']);
  config.get.mockReturnValue(30);

  // The real policy, not a stub: `purgeAfter` is §9.3's promise to the consumer, and
  // the point of the consolidation is that upload and purge now compute it the same way.
  const users = createMock<Repository<User>>(['findOne']);
  users.findOne.mockResolvedValue(
    Object.assign(new User(), { id: OWNER, createdAt: NOW, lastActiveAt: NOW }),
  );
  const retention = new RetentionPolicy(config, users);

  const events = new EventEmitter2();
  const removed: PersonPhotoRemovedEvent[] = [];
  events.on(PERSON_PHOTO_EVENTS.REMOVED, (event: PersonPhotoRemovedEvent) => {
    removed.push(event);
  });

  const service = new PersonPhotosService(
    photos,
    dataSource,
    storage,
    imageProcessor,
    settings,
    consents,
    retention,
    new MetricsService(),
    events,
  );

  return {
    service,
    photos,
    renders,
    deletionLog,
    storage,
    consents,
    events,
    removed,
    transactions,
    repositoriesTouched,
    get uniqueViolations(): number {
      return uniqueViolationCounter.count;
    },
  };
}

describe('PersonPhotosService — C-28: a render survives its source photo', () => {
  it('leaves the render row standing, with its label snapshot, after the photo is deleted', async () => {
    const { service, renders, photos } = build({
      rows: [buildPhoto()],
      renders: [buildRender()],
    });

    await service.remove(CONSUMER, PHOTO_A);

    expect(photos.$rows).toHaveLength(0);
    expect(renders.$rows).toHaveLength(1);
    expect(renders.$rows[0]).toMatchObject({
      id: 'eeeeeeee-1111-4222-8333-444455556666',
      // The FK nulled the reference; the history entry and its C-30 grouping label are
      // untouched (§4.18).
      personPhotoId: null,
      personPhotoLabelSnapshot: 'daylight',
      deletedAt: null,
    });
  });

  it('never reaches into tryon_results itself', async () => {
    // The cascade is the database's job. A service that "helpfully" cleaned up renders
    // would delete exactly the thing C-28 promises to keep.
    const { service, repositoriesTouched } = build({
      rows: [buildPhoto()],
      renders: [buildRender()],
    });

    await service.remove(CONSUMER, PHOTO_A);

    expect(repositoriesTouched).not.toContain(TryOnResult);
    expect(repositoriesTouched).toEqual(expect.arrayContaining([PersonPhoto, DeletionLogEntry]));
  });

  it('hard-deletes rather than soft-deletes, because SET NULL is what keeps history', async () => {
    const { service, photos } = build({ rows: [buildPhoto()], renders: [buildRender()] });

    await service.remove(CONSUMER, PHOTO_A);

    // A soft delete would leave the row, so the FK would never fire and a purge would
    // later have to clean up behind it.
    expect(photos.$rows).toHaveLength(0);
    expect(photos.softDelete).not.toHaveBeenCalled();
  });
});

describe('PersonPhotosService — C-16: exactly one active photo', () => {
  it('demotes by predicate and promotes by id, in one transaction', async () => {
    const { service, photos, transactions } = build({
      rows: [
        buildPhoto({ id: PHOTO_A, isActive: true }),
        buildPhoto({ id: PHOTO_B, isActive: false }),
      ],
    });

    await service.activate(OWNER, PHOTO_B);

    expect(photos.update).toHaveBeenNthCalledWith(
      1,
      { userId: OWNER, isActive: true },
      { isActive: false },
    );
    expect(photos.update).toHaveBeenNthCalledWith(
      2,
      { id: PHOTO_B, userId: OWNER },
      { isActive: true },
    );
    expect(transactions.started).toBe(1);
    expect(transactions.committed).toBe(1);
  });

  it('leaves exactly one active photo when two devices activate different photos at once', async () => {
    const harness = build({
      rows: [
        buildPhoto({ id: PHOTO_A, isActive: true }),
        buildPhoto({ id: PHOTO_B, isActive: false }),
      ],
      serialise: true,
    });

    const results = await Promise.allSettled([
      harness.service.activate(OWNER, PHOTO_A),
      harness.service.activate(OWNER, PHOTO_B),
    ]);

    // Both are legitimate requests and both may succeed — what must never happen is
    // two active rows, or none.
    const active = harness.photos.$rows.filter((row) => row.isActive);
    expect(active).toHaveLength(1);
    expect([PHOTO_A, PHOTO_B]).toContain(active[0].id);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    // The demote-then-promote order means the partial unique index is never asked to
    // hold two rows in the first place.
    expect(harness.uniqueViolations).toBe(0);
  });

  it('never loads a row, flips a boolean and saves it back', async () => {
    const { service, photos } = build({
      rows: [
        buildPhoto({ id: PHOTO_A, isActive: true }),
        buildPhoto({ id: PHOTO_B, isActive: false }),
      ],
    });

    await service.activate(OWNER, PHOTO_B);

    // `save()` on a loaded entity is the read-then-write this design exists to avoid.
    expect(photos.save).not.toHaveBeenCalled();
  });

  it('refuses to activate a photo blocked by moderation (A-34)', async () => {
    const { service } = build({
      rows: [
        buildPhoto({ id: PHOTO_A, moderationState: PhotoModerationState.BLOCKED, isActive: false }),
      ],
    });

    await expect(service.activate(OWNER, PHOTO_A)).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_BLOCKED_BY_MODERATION,
    });
  });

  it('activates her first photo automatically and leaves later ones inactive', async () => {
    const { service, photos } = build();

    const first = await service.create(CONSUMER, { key: photoKey(OWNER, 'one') });
    expect(first.isActive).toBe(true);

    const second = await service.create(CONSUMER, { key: photoKey(OWNER, 'two') });
    expect(second.isActive).toBe(false);
    expect(photos.$rows.filter((row) => row.isActive)).toHaveLength(1);
  });
});

describe('PersonPhotosService — §9.2: ownership is a predicate', () => {
  it('reports another account’s photo as not owned, so §2.4 can mask it to not-found', async () => {
    const { service } = build({ rows: [buildPhoto({ id: PHOTO_A, userId: OTHER })] });

    await expect(service.assertOwnedPhoto(OWNER, PHOTO_A)).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_NOT_OWNED,
    });
  });

  it('reports an id that exists nowhere as not found', async () => {
    const { service } = build({ rows: [buildPhoto()] });

    await expect(service.assertOwnedPhoto(OWNER, PHOTO_B)).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_NOT_FOUND,
    });
  });

  it('puts the userId in the query rather than comparing it afterwards', async () => {
    const { service, photos } = build({ rows: [buildPhoto()] });

    await service.assertOwnedPhoto(OWNER, PHOTO_A);

    expect(photos.findOne).toHaveBeenCalledWith({ where: { id: PHOTO_A, userId: OWNER } });
  });

  it('refuses to delete another account’s photo, and deletes no object', async () => {
    const { service, storage, photos } = build({
      rows: [buildPhoto({ id: PHOTO_A, userId: OTHER })],
    });

    await expect(service.remove(CONSUMER, PHOTO_A)).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_NOT_OWNED,
    });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(photos.$rows).toHaveLength(1);
  });

  it('repeats the ownership predicate on the rename write', async () => {
    const { service, photos } = build({ rows: [buildPhoto()] });

    await service.rename(OWNER, PHOTO_A, { label: 'evening' });

    expect(photos.update).toHaveBeenCalledWith(
      { id: PHOTO_A, userId: OWNER },
      { label: 'evening' },
    );
  });

  it('scopes every listed photo to the caller', async () => {
    const { service, photos } = build({
      rows: [buildPhoto({ id: PHOTO_A }), buildPhoto({ id: PHOTO_B, userId: OTHER })],
    });

    const listed = await service.list(OWNER);

    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(PHOTO_A);
    expect(photos.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }));
  });
});

describe('PersonPhotosService — §3.4: signed URLs are scoped to the owner', () => {
  it('signs with the row’s own userId, never with the caller’s', async () => {
    const { service, storage } = build({ rows: [buildPhoto()] });

    await service.list(OWNER);

    expect(storage.signedUrl).toHaveBeenCalledWith(photoKey(OWNER, 'photo-a'), OWNER);
  });

  it('never returns a raw storage key in the response', async () => {
    const { service } = build({ rows: [buildPhoto()] });

    const [photo] = await service.list(OWNER);

    expect(Object.keys(photo)).not.toContain('storageKey');
    expect(Object.keys(photo)).not.toContain('blurredThumbnailKey');
    expect(Object.keys(photo)).not.toContain('hash');
  });

  /**
   * The real signer, not a mock. A URL scoped to one account must be unredeemable by
   * another (§9.2, §3.4 step 4) — asserting that against a stub would prove only that
   * the stub was called.
   */
  it('issues a token another account cannot redeem', () => {
    const config: StorageConfig = {
      driver: 'local',
      root: '/nowhere-this-suite-never-touches-disk',
      urlSecret: 'a'.repeat(64),
      apiBaseUrl: 'http://localhost:4000',
      photoUrlTtlSeconds: 300,
      renderUrlTtlSeconds: 900,
      publicUrlTtlSeconds: 3600,
      uploadTicketTtlSeconds: 900,
      maxUploadBytes: 25 * 1024 * 1024,
      minFreeBytes: 0,
    };
    const signer = new SignedUrlService(config);
    const key = photoKey(OWNER, 'photo-a');

    const token = signer.issue(key, { subject: OWNER });

    expect(signer.verify(token, { subject: OWNER })).toMatchObject({ key, sub: OWNER });
    expect(() => signer.verify(token, { subject: OTHER })).toThrow();
  });
});

describe('PersonPhotosService — C-38 and §9.3: deletion', () => {
  it('removes the object and the blurred thumbnail, then the row', async () => {
    const photo = buildPhoto();
    const { service, storage } = build({ rows: [photo] });

    await service.remove(CONSUMER, PHOTO_A);

    expect(storage.delete).toHaveBeenCalledWith(photo.storageKey);
    expect(storage.delete).toHaveBeenCalledWith(photo.blurredThumbnailKey);
  });

  it('writes a completed deletion_log row with a verification hash (§9.3)', async () => {
    const { service, deletionLog } = build({ rows: [buildPhoto()] });

    await service.remove(CONSUMER, PHOTO_A);

    expect(deletionLog.$rows).toHaveLength(1);
    expect(deletionLog.$rows[0]).toMatchObject({
      subjectType: DeletionSubject.PERSON_PHOTO,
      subjectId: PHOTO_A,
      userId: OWNER,
      rowsDeleted: { person_photos: 1 },
      storageKeysDeleted: 2,
      failureReason: null,
    });
    // C-38: complete before the response is written, not merely promised within 24h.
    expect(deletionLog.$rows[0].completedAt).toBeInstanceOf(Date);
    expect(deletionLog.$rows[0].verificationHash).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * C-16 is announced, not performed. This module holds no reference to `tryon_cache`
   * and no port into `TryOnModule`; it states that a photograph is gone and carries the
   * hash the §3.7 key was built from, which is the only handle that identifies every
   * cache row the photograph could have produced.
   *
   * That the announcement is *acted on* cannot be proved here — a spec that stubs the
   * far side proves only that the stub was called. It is proved against the real
   * `ApiModule` graph in `test/integration/person-photo-cache-retirement.spec.ts`.
   */
  it('announces the removal with the §3.7 hash, so C-16 retirement has a handle', async () => {
    const { service, removed } = build({ rows: [buildPhoto()] });

    await service.remove(CONSUMER, PHOTO_A);

    expect(removed).toEqual([
      {
        userId: OWNER,
        photoId: PHOTO_A,
        personPhotoHash: 'a'.repeat(64),
        wasActive: true,
        occurredAt: expect.any(Date),
      },
    ]);
  });

  it('announces it after the commit, never inside the transaction (§2.9 rule 3)', async () => {
    // A listener that fired on a transaction which later rolled back would retire the
    // cache entries of a photograph that still exists.
    const { service, transactions, events } = build({ rows: [buildPhoto()] });
    const committedWhenEmitted: number[] = [];
    events.on(PERSON_PHOTO_EVENTS.REMOVED, () => committedWhenEmitted.push(transactions.committed));

    await service.remove(CONSUMER, PHOTO_A);

    expect(committedWhenEmitted).toEqual([1]);
  });

  it('carries no storage key, no URL and no label — only the hash (E-12)', async () => {
    const photo = buildPhoto();
    const { service, removed } = build({ rows: [photo] });

    await service.remove(CONSUMER, PHOTO_A);

    const serialised = JSON.stringify(removed[0]);
    expect(serialised).not.toContain('person-photos/');
    expect(serialised).not.toContain('thumbnails/');
    expect(serialised).not.toContain('daylight');
  });

  it('deletes the photo even when nothing is listening for the removal', async () => {
    // A stale cache row is a wasted cache hit. An undeletable photograph is a privacy
    // failure — the deletion must never depend on another module being wired up.
    const { service, photos, events } = build({ rows: [buildPhoto()] });
    events.removeAllListeners(PERSON_PHOTO_EVENTS.REMOVED);

    await service.remove(CONSUMER, PHOTO_A);

    expect(photos.$rows).toHaveLength(0);
  });

  it('deletes the photo even when a listener never finishes', async () => {
    // C-38 belongs to this call and to nothing downstream: retirement is hygiene and
    // runs on its own schedule. (That the deletion really has completed *before* the
    // sweep does is asserted end to end in the integration spec.)
    const { service, photos, events } = build({ rows: [buildPhoto()] });
    const stalled = jest.fn((): void => {
      // A listener that never resolves, registered the way `@OnEvent({ async: true })`
      // registers one.
      void new Promise<void>(() => undefined);
    });
    events.on(PERSON_PHOTO_EVENTS.REMOVED, stalled, { async: true });

    await service.remove(CONSUMER, PHOTO_A);

    expect(photos.$rows).toHaveLength(0);
  });

  it('emits the A-3 audit row without a storage key, a URL or a label (E-12)', async () => {
    const { service, events } = build({ rows: [buildPhoto()] });
    const recorded: unknown[] = [];
    events.on(AUDIT_RECORD_EVENT, (event: unknown) => recorded.push(event));

    await service.remove(CONSUMER, PHOTO_A);

    expect(recorded).toHaveLength(1);
    const serialised = JSON.stringify(recorded[0]);
    expect(serialised).toContain(AUDIT_ACTIONS.PERSON_PHOTO_DELETED);
    expect(serialised).not.toContain('person-photos/');
    expect(serialised).not.toContain('thumbnails/');
    expect(serialised).not.toContain('daylight');
  });
});

describe('PersonPhotosService — C-11 and C-14: finalising an upload', () => {
  it('requires current consent before anything is read or written', async () => {
    const { service, consents, photos, storage } = build();
    consents.assertConsentIsCurrent.mockRejectedValueOnce(
      Object.assign(new Error('consent'), { errorCode: ErrorCode.CONSENT_REQUIRED }),
    );

    await expect(service.create(CONSUMER, { key: photoKey(OWNER, 'one') })).rejects.toBeDefined();

    expect(storage.head).not.toHaveBeenCalled();
    expect(photos.$rows).toHaveLength(0);
  });

  it('refuses a key under another account’s prefix', async () => {
    const { service, photos } = build();

    await expect(
      service.create(CONSUMER, { key: photoKey(OTHER, 'not-hers') }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STORAGE_PATH_REJECTED });
    expect(photos.$rows).toHaveLength(0);
  });

  it('refuses a key that names no stored object', async () => {
    const { service, storage } = build();
    storage.head.mockResolvedValueOnce(null);

    await expect(service.create(CONSUMER, { key: photoKey(OWNER, 'ghost') })).rejects.toMatchObject(
      {
        errorCode: ErrorCode.FILE_NOT_FOUND,
      },
    );
  });

  it('re-derives dimensions from the bytes rather than trusting the client (C-14)', async () => {
    const { service, photos } = build();

    await service.create(CONSUMER, { key: photoKey(OWNER, 'one'), label: 'daylight' });

    expect(photos.$rows[0]).toMatchObject({
      width: 1080,
      height: 1620,
      byteSize: 842_133,
      mimeType: 'image/jpeg',
      // The sha256 the driver computed while streaming — the §3.7 cache input.
      hash: 'f'.repeat(64),
      moderationState: PhotoModerationState.PENDING,
    });
  });

  it('rejects a photo that fails the server-side checks, and removes the orphaned object', async () => {
    const harness = build();
    const processor = harness.service as unknown as {
      imageProcessor: jest.Mocked<ImageService>;
    };
    processor.imageProcessor.metadata.mockResolvedValueOnce({
      width: 1920,
      height: 1080,
      format: 'gif',
      byteSize: 100,
      hasAlpha: false,
      orientation: 1,
    });

    await expect(
      harness.service.create(CONSUMER, { key: photoKey(OWNER, 'landscape') }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.PHOTO_VALIDATION_FAILED });

    expect(harness.photos.$rows).toHaveLength(0);
    expect(harness.storage.delete).toHaveBeenCalledWith(photoKey(OWNER, 'landscape'));
  });

  it('enforces photos.maxPerConsumer (C-16)', async () => {
    const { service } = build({
      rows: [buildPhoto({ id: PHOTO_A }), buildPhoto({ id: PHOTO_B, isActive: false })],
      maxPhotos: 2,
    });

    await expect(service.create(CONSUMER, { key: photoKey(OWNER, 'three') })).rejects.toMatchObject(
      {
        errorCode: ErrorCode.PHOTO_LIMIT_REACHED,
        details: { max: 2 },
      },
    );
  });

  it('keeps the photo when the blurred thumbnail cannot be generated', async () => {
    const harness = build();
    const processor = harness.service as unknown as {
      imageProcessor: jest.Mocked<ImageService>;
    };
    processor.imageProcessor.toBlurredModerationThumbnail.mockRejectedValueOnce(
      new Error('encoder tripped'),
    );

    const saved = await harness.service.create(CONSUMER, { key: photoKey(OWNER, 'one') });

    expect(saved.id).toBeDefined();
    expect(harness.photos.$rows[0].blurredThumbnailKey).toBeNull();
  });
});

describe('PersonPhotosService — the surface modules/tryon consumes', () => {
  it('resolves her active photo when none is named', async () => {
    const { service } = build({
      rows: [
        buildPhoto({ id: PHOTO_A, isActive: false }),
        buildPhoto({ id: PHOTO_B, isActive: true }),
      ],
    });

    await expect(service.resolveGenerationPhoto(OWNER)).resolves.toMatchObject({ id: PHOTO_B });
  });

  it('resolves the photo she named, once ownership is proved', async () => {
    const { service } = build({
      rows: [
        buildPhoto({ id: PHOTO_A, isActive: true }),
        buildPhoto({ id: PHOTO_B, isActive: false }),
      ],
    });

    await expect(service.resolveGenerationPhoto(OWNER, PHOTO_B)).resolves.toMatchObject({
      id: PHOTO_B,
    });
  });

  it('refuses another account’s photo id', async () => {
    const { service } = build({ rows: [buildPhoto({ id: PHOTO_A, userId: OTHER })] });

    await expect(service.resolveGenerationPhoto(OWNER, PHOTO_A)).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_NOT_OWNED,
    });
  });

  it('refuses when she has no active photo at all', async () => {
    const { service } = build({ rows: [buildPhoto({ id: PHOTO_A, isActive: false })] });

    await expect(service.resolveGenerationPhoto(OWNER)).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_NOT_FOUND,
    });
  });

  it('refuses a photo blocked by moderation before any generation is started', async () => {
    const { service } = build({
      rows: [buildPhoto({ id: PHOTO_A, moderationState: PhotoModerationState.BLOCKED })],
    });

    await expect(service.resolveGenerationPhoto(OWNER, PHOTO_A)).rejects.toMatchObject({
      errorCode: ErrorCode.PHOTO_BLOCKED_BY_MODERATION,
    });
  });

  it('signs a photo for its owner, whoever asks', async () => {
    const { service, storage } = build();

    service.signedUrlFor({ storageKey: photoKey(OWNER, 'photo-a'), userId: OWNER });

    expect(storage.signedUrl).toHaveBeenCalledWith(photoKey(OWNER, 'photo-a'), OWNER);
  });

  it('exposes nothing that reaches into another module’s tables', () => {
    const { service } = build();

    // The C-16 port is gone. `person-photos` announces a removal and stops; anything
    // shaped like `retireCacheEntriesFor` here would be this module reaching across
    // the §4.33 ownership line again.
    expect('retireCacheEntriesFor' in service).toBe(false);
  });
});
