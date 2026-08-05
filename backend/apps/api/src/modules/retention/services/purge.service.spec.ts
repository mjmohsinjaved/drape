/**
 * PRD C-27, §9.3 — the retention purge.
 *
 * **The assertion this file exists for:**
 *
 * > C-27: "Renders persist for the life of the account. They are **not subject to a
 * > time-based purge** and are removed only when she deletes them individually or
 * > deletes her account."
 *
 * A render costs her quota and the brand money to produce, and it is the only artefact
 * of the whole product she keeps. A purge that took one would be unrecoverable and
 * silent — it would look exactly like a purge that worked. So the guarantee is asserted
 * directly, against a store full of expired photographs *and* the renders made from
 * them, rather than inferred from the absence of a query.
 */
import { type ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import type { StorageService, StoredObject } from '@library/storage';

import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { PhotoModerationState } from '@api/modules/person-photos/enums/photo-moderation-state.enum';
import { PERSON_PHOTO_EVENTS } from '@api/modules/person-photos/events/person-photo.events';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { type User } from '@api/modules/users/entities/user.entity';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { DeletionLogEntry } from '../entities/deletion-log-entry.entity';
import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

import { PurgeService } from './purge.service';
import { purgeDateFor, RetentionPolicy } from './retention-policy.service';

import type { InMemoryRepository } from '../../../../test/fixtures';
import type { DataSource, EntityManager, Repository } from 'typeorm';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const LONG_AGO = new Date('2026-06-01T00:00:00.000Z');
const CONSUMER_ID = 'aaaaaaaa-1111-4222-8333-444455556666';

let sequence = 0;

function photo(overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  sequence += 1;
  const id = `40000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  return Object.assign(new PersonPhoto(), {
    id,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    deletedAt: null,
    userId: CONSUMER_ID,
    storageKey: `person-photos/${CONSUMER_ID}/${id}.jpg`,
    blurredThumbnailKey: `thumbnails/person-blurred/${id}-160.webp`,
    hash: 'b'.repeat(64),
    isActive: false,
    label: null,
    uploadedAt: LONG_AGO,
    // Expired: two months ago.
    purgeAfter: LONG_AGO,
    moderationState: PhotoModerationState.APPROVED,
    width: 1200,
    height: 1600,
    byteSize: 400_000,
    mimeType: 'image/jpeg',
    ...overrides,
  });
}

/** A render produced from `sourcePhoto`. Old enough that any time-based rule would take it. */
function render(sourcePhoto: PersonPhoto): TryOnResult {
  sequence += 1;
  const id = `50000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  return Object.assign(new TryOnResult(), {
    id,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    deletedAt: null,
    jobId: null,
    userId: CONSUMER_ID,
    garmentId: null,
    personPhotoId: sourcePhoto.id,
    storageKey: `renders/${CONSUMER_ID}/${id}.png`,
    thumbnailKey: `thumbnails/render/${id}-320.webp`,
    cacheKey: 'c'.repeat(64),
    garmentTitleSnapshot: 'Anarkali in ivory',
    garmentCategorySnapshot: 'Bridal',
    garmentPriceSnapshot: null,
    garmentCurrencySnapshot: 'PKR',
    personPhotoLabelSnapshot: null,
    isTestRender: false,
    width: 1024,
    height: 1536,
    byteSize: 900_000,
    marketingOptInAt: null,
  });
}

interface Harness {
  readonly service: PurgeService;
  readonly photos: InMemoryRepository<PersonPhoto>;
  readonly renders: InMemoryRepository<TryOnResult>;
  readonly deletionLog: InMemoryRepository<DeletionLogEntry>;
  readonly storage: jest.Mocked<StorageService>;
  readonly events: EventEmitter2;
  readonly deletedKeys: string[];
  readonly policy: RetentionPolicy;
}

interface BuildOptions {
  photos?: PersonPhoto[];
  renders?: TryOnResult[];
  /** What `PHOTO_RETENTION_DAYS` reads as. Omit for the §7 default. */
  retentionDays?: number;
}

function build(options: BuildOptions = {}): Harness {
  const photos = createInMemoryRepository<PersonPhoto>({ rows: options.photos ?? [] });
  const renders = createInMemoryRepository<TryOnResult>({ rows: options.renders ?? [] });
  const deletionLog = createInMemoryRepository<DeletionLogEntry>();

  // `recomputePurgeDates` is one correlated UPDATE; the in-memory repository does not
  // emulate a query builder, so it is stubbed to report that nothing needed changing.
  // The fixtures already carry the dates the recompute would have produced.
  const noopUpdate = {
    update: () => noopUpdate,
    set: () => noopUpdate,
    where: () => noopUpdate,
    andWhere: () => noopUpdate,
    execute: async () => ({ affected: 0 }),
  };
  (photos as unknown as { createQueryBuilder: unknown }).createQueryBuilder = () => noopUpdate;

  const deletedKeys: string[] = [];
  const storage = createMock<StorageService>(['head', 'delete']);
  storage.head.mockImplementation(async (key: string): Promise<StoredObject | null> => ({
    key,
    byteSize: 1_000,
    contentType: 'image/jpeg',
    etag: 'd'.repeat(64),
    lastModified: NOW,
  }));
  storage.delete.mockImplementation(async (key: string) => {
    deletedKeys.push(key);
    return true;
  });

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === PersonPhoto) return photos;
      if (entity === DeletionLogEntry) return deletionLog;
      if (entity === TryOnResult) {
        throw new Error(
          'C-27 violation: the purge asked for the tryon_results repository. Renders are ' +
            'not subject to a time-based purge.',
        );
      }
      throw new Error(`Unexpected repository requested by the purge: ${String(entity)}`);
    },
  } as unknown as EntityManager;

  const dataSource = {
    createQueryRunner: () => ({
      manager,
      isTransactionActive: false,
      connect: async (): Promise<void> => undefined,
      startTransaction: async (): Promise<void> => undefined,
      commitTransaction: async (): Promise<void> => undefined,
      rollbackTransaction: async (): Promise<void> => undefined,
      release: async (): Promise<void> => undefined,
    }),
  } as unknown as DataSource;

  const config = createMock<ConfigService>(['get']);
  config.get.mockReturnValue(options.retentionDays ?? 30);

  const users = createMock<Repository<User>>(['findOne']);
  users.findOne.mockResolvedValue(null);
  const policy = new RetentionPolicy(config, users);

  const events = new EventEmitter2();
  const service = new PurgeService(photos, dataSource, storage, policy, events);

  return { service, policy, photos, renders, deletionLog, storage, events, deletedKeys };
}

describe('PurgeService', () => {
  describe('C-27 — the purge cannot delete a render', () => {
    it('leaves every render standing after purging the photographs they came from', async () => {
      const expired = [photo(), photo(), photo()];
      const theirRenders = expired.flatMap((source) => [render(source), render(source)]);
      const harness = build({ photos: expired, renders: theirRenders });

      const report = await harness.service.purgeExpiredPhotos(NOW);

      expect(report.photosDeleted).toBe(3);
      expect(harness.photos.$rows).toHaveLength(0);

      // The whole point. Six renders, every one of them older than the retention
      // window, every one of them produced from a photograph that has just been
      // deleted — and every one of them still here.
      expect(harness.renders.$rows).toHaveLength(6);
      expect(harness.renders.$rows.every((row) => row.deletedAt === null)).toBe(true);
      expect(harness.renders.delete).not.toHaveBeenCalled();
      expect(harness.renders.softDelete).not.toHaveBeenCalled();
    });

    it('never asks for the tryon_results repository at all', async () => {
      // The transactional manager in this harness throws if it is asked for
      // `TryOnResult`. A purge that touched renders would fail here rather than
      // quietly succeeding, which is the failure mode worth having.
      const harness = build({ photos: [photo()], renders: [] });

      await expect(harness.service.purgeExpiredPhotos(NOW)).resolves.toMatchObject({
        photosDeleted: 1,
      });
    });

    it('deletes no render object from storage', async () => {
      const source = photo();
      const harness = build({ photos: [source], renders: [render(source)] });

      await harness.service.purgeExpiredPhotos(NOW);

      expect(harness.deletedKeys).toEqual(
        expect.arrayContaining([source.storageKey, source.blurredThumbnailKey]),
      );
      expect(harness.deletedKeys.some((key) => key.startsWith('renders/'))).toBe(false);
      expect(harness.deletedKeys.some((key) => key.startsWith('thumbnails/render/'))).toBe(false);
    });
  });

  describe('§9.3 — what it does purge', () => {
    it('takes photographs past their date and leaves the ones that are not', async () => {
      const expired = photo({ purgeAfter: LONG_AGO });
      const current = photo({ purgeAfter: new Date('2026-09-30T00:00:00.000Z') });
      const harness = build({ photos: [expired, current] });

      const report = await harness.service.purgeExpiredPhotos(NOW);

      expect(report.photosDeleted).toBe(1);
      expect(harness.photos.$rows).toHaveLength(1);
      expect(harness.photos.$rows[0].id).toBe(current.id);
    });

    it('hard-deletes, so ON DELETE SET NULL can leave her history standing (C-28)', async () => {
      const harness = build({ photos: [photo()] });

      await harness.service.purgeExpiredPhotos(NOW);

      // A soft delete would leave her photograph's metadata in the database forever,
      // which is not what §9.3 promised — and would not fire the foreign key that
      // nulls `tryon_results.personPhotoId`.
      expect(harness.photos.delete).toHaveBeenCalled();
      expect(harness.photos.softDelete).not.toHaveBeenCalled();
    });

    it('writes a completed, verifiable deletion_log row per photograph (§9.3, §4.31)', async () => {
      const target = photo();
      const harness = build({ photos: [target] });

      await harness.service.purgeExpiredPhotos(NOW);

      expect(harness.deletionLog.$rows).toHaveLength(1);
      expect(harness.deletionLog.$rows[0]).toMatchObject({
        subjectType: DeletionSubject.PERSON_PHOTO,
        subjectId: target.id,
        userId: CONSUMER_ID,
        initiatedBy: DeletionInitiator.PURGE_JOB,
        // A cron job has no actor. Inventing one would put a person's name against a
        // machine's decision (§4.30).
        actorId: null,
        rowsDeleted: { person_photos: 1 },
        storageKeysDeleted: 2,
        failureReason: null,
      });
      expect(harness.deletionLog.$rows[0].completedAt).toEqual(NOW);
      expect(harness.deletionLog.$rows[0].verificationHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('announces the removal so the cache can be retired (C-16, §3.7)', async () => {
      const target = photo();
      const harness = build({ photos: [target] });
      const heard: unknown[] = [];
      harness.events.on(PERSON_PHOTO_EVENTS.REMOVED, (event) => heard.push(event));

      await harness.service.purgeExpiredPhotos(NOW);

      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({ photoId: target.id, personPhotoHash: target.hash });
      // The hash and nothing else — no storage key, no URL, nothing loggable (E-12).
      expect(JSON.stringify(heard[0])).not.toContain(target.storageKey);
    });
  });

  describe('bounded, cancellable and non-overlapping', () => {
    it('stops between photographs when cancelled, leaving the rest for the next run', async () => {
      const harness = build({ photos: [photo(), photo(), photo()] });
      harness.storage.delete.mockImplementation(async (key: string) => {
        harness.deletedKeys.push(key);
        // Cancel as soon as the first photograph's objects are being removed.
        harness.service.cancel();
        return true;
      });

      const report = await harness.service.purgeExpiredPhotos(NOW);

      expect(report.cancelled).toBe(true);
      expect(report.photosDeleted).toBe(1);
      expect(harness.photos.$rows).toHaveLength(2);
    });

    it('does nothing when a run is already in flight', async () => {
      const harness = build({ photos: [photo(), photo()] });

      // `running` is set synchronously before the first `await`, so the second call
      // sees it and returns immediately. Two overlapping cron ticks purge the batch
      // once between them, not twice.
      const [first, second] = await Promise.all([
        harness.service.purgeExpiredPhotos(NOW),
        harness.service.purgeExpiredPhotos(NOW),
      ]);

      expect(first.photosDeleted + second.photosDeleted).toBe(2);
      expect(Math.min(first.photosDeleted, second.photosDeleted)).toBe(0);
      expect(harness.photos.$rows).toHaveLength(0);
      expect(harness.deletionLog.$rows).toHaveLength(2);
    });
  });

  describe('the retention policy itself', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    it('is last activity plus the retention window, not upload plus the window (§4.16)', () => {
      const lastActiveAt = new Date('2026-08-01T00:00:00.000Z');

      expect(purgeDateFor({ lastActiveAt, createdAt }, 30)).toEqual(
        new Date('2026-08-31T00:00:00.000Z'),
      );
      // A consumer who returns every week is never purged from under herself — which is
      // exactly why §4.16 says the cron recomputes this column rather than trusting the
      // value written at upload.
      expect(
        purgeDateFor({ lastActiveAt: new Date('2026-08-08T00:00:00.000Z'), createdAt }, 30),
      ).toEqual(new Date('2026-09-07T00:00:00.000Z'));
    });

    it('falls back to createdAt, exactly as the recompute SQL COALESCEs (§4.16)', () => {
      // Signed up, never returned. The pure twin used to take a bare `Date` and had no
      // fallback at all, so it disagreed with its own `UPDATE` on precisely the account
      // where the fallback decides whether the photograph ever expires.
      expect(purgeDateFor({ lastActiveAt: null, createdAt }, 30)).toEqual(
        new Date('2026-01-31T00:00:00.000Z'),
      );
    });

    it('clamps a nonsense PHOTO_RETENTION_DAYS to the §7 default, everywhere at once', () => {
      // The defect this consolidation closes: `PurgeService` clamped `0` to 30 days while
      // `PersonPhotosService` multiplied by it and wrote `purgeAfter = now`, so every new
      // photograph was already due on the next nightly run.
      for (const configured of [0, -1, 7.5, Number.NaN]) {
        expect(build({ retentionDays: configured }).policy.retentionDays()).toBe(30);
      }
      expect(build({ retentionDays: 14 }).policy.retentionDays()).toBe(14);
    });

    it('never dates a photograph in the past, however PHOTO_RETENTION_DAYS is set', async () => {
      const now = new Date('2026-08-15T12:00:00.000Z');
      const purgeAfter = await build({ retentionDays: 0 }).policy.purgeDateForUser(
        CONSUMER_ID,
        now,
      );

      expect(purgeAfter.getTime()).toBeGreaterThan(now.getTime());
    });
  });
});
