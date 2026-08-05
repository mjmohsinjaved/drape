/**
 * ARCHITECTURE §3.5 step 4, §3.2 requirement 4, PRD §9.3 and C-27 — the orphan sweep.
 *
 * **The two assertions this file exists for, and they pull in opposite directions:**
 *
 * 1. An object that **no row names** and that is older than six hours is deleted, and the
 *    deletion is recorded. Without this, a redeemed upload ticket whose `POST
 *    /person-photos` never arrived leaves a photograph on disk that `PurgeService` cannot
 *    see (it iterates rows), that `GET /me/data` cannot show her (it projects rows), and
 *    that no `deletion_log` row has ever heard of. §9.3's "person photos deleted 30 days
 *    after last account activity" is simply false for that file, permanently.
 *
 * 2. An object that **any** row names is left completely alone — a live row, a
 *    soft-deleted row, and a row written seconds ago, all three. C-27 says renders are
 *    "not subject to a time-based purge", and a sweep that got this wrong would delete
 *    somebody's history and look exactly like a sweep that worked.
 */
import type { StorageService, StoredObject } from '@library/storage';

import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';

import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { type DeletionLogEntry } from '../entities/deletion-log-entry.entity';
import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

import { OrphanSweepService } from './orphan-sweep.service';

import type { InMemoryRepository } from '../../../../test/fixtures';

const NOW = new Date('2026-08-15T12:00:00.000Z');
/** Comfortably past the six-hour grace period. */
const LONG_AGO = new Date('2026-08-14T00:00:00.000Z');
/** Inside it — a write that may still be completing. */
const MOMENTS_AGO = new Date('2026-08-15T11:59:30.000Z');

const CONSUMER_ID = 'aaaaaaaa-1111-4222-8333-444455556666';

function key(namespace: string, objectId: string, ext: string): string {
  return `${namespace}/${CONSUMER_ID}/${objectId}.${ext}`;
}

const PHOTO_ID = 'bbbbbbbb-1111-4222-8333-444455556666';
const LIVE_RENDER_ID = 'cccccccc-1111-4222-8333-444455556666';
const SOFT_DELETED_RENDER_ID = 'dddddddd-1111-4222-8333-444455556666';
const FRESH_RENDER_ID = 'eeeeeeee-1111-4222-8333-444455556666';
const ORPHAN_RENDER_ID = 'ffffffff-1111-4222-8333-444455556666';
const ORPHAN_PHOTO_ID = 'a1a1a1a1-1111-4222-8333-444455556666';
const CACHED_RENDER_ID = 'b2b2b2b2-1111-4222-8333-444455556666';
const EXPORT_ID = 'c3c3c3c3-1111-4222-8333-444455556666';

function object(objectKey: string, lastModified: Date, byteSize = 1_000): StoredObject {
  return {
    key: objectKey,
    byteSize,
    contentType: 'image/png',
    etag: 'd'.repeat(64),
    lastModified,
  };
}

function photoRow(id: string, overrides: Partial<PersonPhoto> = {}): PersonPhoto {
  return Object.assign(new PersonPhoto(), {
    id,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    deletedAt: null,
    userId: CONSUMER_ID,
    storageKey: key('person-photos', id, 'jpg'),
    blurredThumbnailKey: null,
    ...overrides,
  });
}

function renderRow(id: string, overrides: Partial<TryOnResult> = {}): TryOnResult {
  return Object.assign(new TryOnResult(), {
    id,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    deletedAt: null,
    userId: CONSUMER_ID,
    storageKey: key('renders', id, 'png'),
    thumbnailKey: null,
    cacheKey: 'c'.repeat(64),
    ...overrides,
  });
}

interface Harness {
  readonly service: OrphanSweepService;
  readonly deletionLog: InMemoryRepository<DeletionLogEntry>;
  readonly storage: jest.Mocked<StorageService>;
  readonly deletedKeys: string[];
}

interface BuildOptions {
  objectsByPrefix?: Record<string, StoredObject[]>;
  photos?: PersonPhoto[];
  renders?: TryOnResult[];
  cache?: TryOnCache[];
  temporaryFilesDeleted?: number;
}

function build(options: BuildOptions = {}): Harness {
  const photos = createInMemoryRepository<PersonPhoto>({ rows: options.photos ?? [] });
  const renders = createInMemoryRepository<TryOnResult>({ rows: options.renders ?? [] });
  const cache = createInMemoryRepository<TryOnCache>({ rows: options.cache ?? [] });
  const deletionLog = createInMemoryRepository<DeletionLogEntry>();

  const deletedKeys: string[] = [];
  const storage = createMock<StorageService>(['list', 'delete', 'sweepTemporaryFiles']);
  storage.list.mockImplementation(
    async (prefix: string) => (options.objectsByPrefix ?? {})[prefix] ?? [],
  );
  storage.delete.mockImplementation(async (objectKey: string) => {
    deletedKeys.push(objectKey);
    return true;
  });
  storage.sweepTemporaryFiles.mockResolvedValue(options.temporaryFilesDeleted ?? 0);

  return {
    service: new OrphanSweepService(photos, renders, cache, deletionLog, storage),
    deletionLog,
    storage,
    deletedKeys,
  };
}

describe('OrphanSweepService — an object no row names (§3.5 step 4)', () => {
  it('deletes a photograph whose upload ticket was redeemed and never claimed', async () => {
    const orphan = key('person-photos', ORPHAN_PHOTO_ID, 'jpg');
    const harness = build({
      objectsByPrefix: { 'person-photos/': [object(orphan, LONG_AGO, 400_000)] },
      photos: [],
    });

    const report = await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([orphan]);
    expect(report.personPhotos.deleted).toBe(1);
    expect(report.personPhotos.bytesReclaimed).toBe(400_000);
  });

  it('records the deletion in deletion_log, keyed on the object’s own id and owner', async () => {
    const orphan = key('person-photos', ORPHAN_PHOTO_ID, 'jpg');
    const harness = build({
      objectsByPrefix: { 'person-photos/': [object(orphan, LONG_AGO, 400_000)] },
    });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletionLog.$rows).toHaveLength(1);
    expect(harness.deletionLog.$rows[0]).toMatchObject({
      subjectType: DeletionSubject.PERSON_PHOTO,
      subjectId: ORPHAN_PHOTO_ID,
      userId: CONSUMER_ID,
      initiatedBy: DeletionInitiator.PURGE_JOB,
      actorId: null,
      completedAt: NOW,
      bytesReclaimed: '400000',
      storageKeysDeleted: 1,
      failureReason: null,
    });
    // `{}` is the whole point: these bytes were known to no table at all.
    expect(harness.deletionLog.$rows[0]?.rowsDeleted).toEqual({});
  });

  it('deletes an orphaned render object and records it as a TRYON_RESULT', async () => {
    const orphan = key('renders', ORPHAN_RENDER_ID, 'png');
    const harness = build({
      objectsByPrefix: { 'renders/': [object(orphan, LONG_AGO)] },
      renders: [],
    });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([orphan]);
    expect(harness.deletionLog.$rows[0]).toMatchObject({
      subjectType: DeletionSubject.TRYON_RESULT,
      subjectId: ORPHAN_RENDER_ID,
    });
  });

  it('sweeps <root>/.tmp of files older than six hours (§3.2 requirement 4)', async () => {
    const harness = build({ temporaryFilesDeleted: 4 });

    const report = await harness.service.sweepOnce(NOW);

    expect(report.temporaryFilesDeleted).toBe(4);
    const [olderThan] = harness.storage.sweepTemporaryFiles.mock.calls[0] ?? [];
    expect(olderThan?.toISOString()).toBe('2026-08-15T06:00:00.000Z');
  });

  it('leaves an object whose key it cannot parse exactly where it is', async () => {
    const strange = 'renders/not-a-uuid/whatever.png';
    const harness = build({ objectsByPrefix: { 'renders/': [object(strange, LONG_AGO)] } });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([]);
    expect(harness.deletionLog.$rows).toHaveLength(0);
  });
});

/**
 * C-27, restated as three concrete rows. Each of these deleted would be an unrecoverable,
 * silent loss of somebody's history.
 */
describe('OrphanSweepService — a live object is never touched (C-27)', () => {
  it('leaves a render with a live row alone', async () => {
    const live = key('renders', LIVE_RENDER_ID, 'png');
    const harness = build({
      objectsByPrefix: { 'renders/': [object(live, LONG_AGO)] },
      renders: [renderRow(LIVE_RENDER_ID)],
    });

    const report = await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([]);
    expect(report.renders.deleted).toBe(0);
    expect(harness.deletionLog.$rows).toHaveLength(0);
  });

  it('leaves a render with a SOFT-DELETED row alone', async () => {
    // C-31 soft-deletes the row and hard-deletes the file. If the file delete failed the
    // object is a genuine orphan — but a sweep that ignored soft-deleted rows would also
    // race the *successful* path and delete a file out from under a request in flight.
    const softDeleted = key('renders', SOFT_DELETED_RENDER_ID, 'png');
    const harness = build({
      objectsByPrefix: { 'renders/': [object(softDeleted, LONG_AGO)] },
      renders: [renderRow(SOFT_DELETED_RENDER_ID, { deletedAt: LONG_AGO })],
    });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([]);
  });

  it('leaves a render written seconds ago alone, row or no row', async () => {
    const fresh = key('renders', FRESH_RENDER_ID, 'png');
    const harness = build({
      objectsByPrefix: { 'renders/': [object(fresh, MOMENTS_AGO)] },
      renders: [],
    });

    const report = await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([]);
    expect(report.renders.examined).toBe(0);
  });

  it('leaves a render a tryon_cache row still points at alone (§3.7)', async () => {
    const cached = key('renders', CACHED_RENDER_ID, 'png');
    const harness = build({
      objectsByPrefix: { 'renders/': [object(cached, LONG_AGO)] },
      renders: [],
      cache: [
        Object.assign(new TryOnCache(), {
          id: 'f4f4f4f4-1111-4222-8333-444455556666',
          deletedAt: null,
          cacheKey: 'c'.repeat(64),
          storageKey: cached,
        }),
      ],
    });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([]);
  });

  it('leaves a photograph with a live row alone', async () => {
    const live = key('person-photos', PHOTO_ID, 'jpg');
    const harness = build({
      objectsByPrefix: { 'person-photos/': [object(live, LONG_AGO)] },
      photos: [photoRow(PHOTO_ID)],
    });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([]);
  });

  it('takes the orphan and leaves its neighbours, in one pass', async () => {
    const live = key('renders', LIVE_RENDER_ID, 'png');
    const softDeleted = key('renders', SOFT_DELETED_RENDER_ID, 'png');
    const fresh = key('renders', FRESH_RENDER_ID, 'png');
    const orphan = key('renders', ORPHAN_RENDER_ID, 'png');

    const harness = build({
      objectsByPrefix: {
        'renders/': [
          object(live, LONG_AGO),
          object(softDeleted, LONG_AGO),
          object(fresh, MOMENTS_AGO),
          object(orphan, LONG_AGO),
        ],
      },
      renders: [
        renderRow(LIVE_RENDER_ID),
        renderRow(SOFT_DELETED_RENDER_ID, { deletedAt: LONG_AGO }),
      ],
    });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([orphan]);
  });
});

describe('OrphanSweepService — export archives (C-39, EXPORT_RETENTION_HOURS)', () => {
  const archive = key('exports', EXPORT_ID, 'zip');

  it('deletes an archive past its 48-hour retention window', async () => {
    const harness = build({
      objectsByPrefix: {
        // 12 August is more than 48 h before 15 August.
        'exports/': [object(archive, new Date('2026-08-12T00:00:00.000Z'), 9_000_000)],
      },
    });

    const report = await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([archive]);
    expect(report.exports.deleted).toBe(1);
    expect(harness.deletionLog.$rows[0]).toMatchObject({
      subjectType: DeletionSubject.EXPORT_ARCHIVE,
      subjectId: EXPORT_ID,
      userId: CONSUMER_ID,
      bytesReclaimed: '9000000',
    });
  });

  it('leaves an archive still inside its window downloadable', async () => {
    const harness = build({
      objectsByPrefix: {
        'exports/': [object(archive, new Date('2026-08-15T06:00:00.000Z'))],
      },
    });

    await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toEqual([]);
  });
});

describe('OrphanSweepService — bounded and non-overlapping', () => {
  it('does nothing on a second concurrent call', async () => {
    const orphan = key('renders', ORPHAN_RENDER_ID, 'png');
    const harness = build({ objectsByPrefix: { 'renders/': [object(orphan, LONG_AGO)] } });

    const first = harness.service.sweepOnce(NOW);
    const second = await harness.service.sweepOnce(NOW);

    expect(second.renders.deleted).toBe(0);
    await first;
    expect(harness.deletedKeys).toEqual([orphan]);
  });

  it('stops between objects when the process is shutting down', async () => {
    const objects = Array.from({ length: 5 }, (_, index) =>
      object(key('renders', `aaaaaaaa-0000-4000-8000-00000000000${index}`, 'png'), LONG_AGO),
    );
    const harness = build({ objectsByPrefix: { 'renders/': objects } });

    harness.storage.delete.mockImplementation(async (objectKey: string) => {
      harness.deletedKeys.push(objectKey);
      harness.service.cancel();
      return true;
    });

    const report = await harness.service.sweepOnce(NOW);

    expect(harness.deletedKeys).toHaveLength(1);
    expect(report.cancelled).toBe(true);
  });

  it('reports nothing reclaimed when the object was already gone', async () => {
    const orphan = key('renders', ORPHAN_RENDER_ID, 'png');
    const harness = build({ objectsByPrefix: { 'renders/': [object(orphan, LONG_AGO)] } });
    harness.storage.delete.mockResolvedValue(false);

    const report = await harness.service.sweepOnce(NOW);

    expect(report.renders.deleted).toBe(0);
    // Nothing was reclaimed, so nothing is claimed in the log.
    expect(harness.deletionLog.$rows).toHaveLength(0);
  });

  it('bounds the listing so a large store cannot stall the scheduler', async () => {
    const harness = build();

    await harness.service.sweepOnce(NOW);

    for (const [, limit] of harness.storage.list.mock.calls) {
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(2_000);
    }
  });
});
