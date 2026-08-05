import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getEntityManagerToken } from '@nestjs/typeorm';

import { Role, UserStatus, type ICurrentUser } from '@library/common';
import { StorageService, type StoredObject } from '@library/storage';

import { PERSON_PHOTO_EVENTS, type PersonPhotoRemovedEvent } from '@api/modules/person-photos';
import { PersonPhoto } from '@api/modules/person-photos/entities/person-photo.entity';
import { PersonPhotosService } from '@api/modules/person-photos/services/person-photos.service';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';
import { PersonPhotoRemovedListener } from '@api/modules/tryon/listeners/person-photo-removed.listener';

import { buildPersonPhoto, buildTryOnResult } from '../factories';
import {
  createInMemoryDataSource,
  type InMemoryDataSource,
  type InMemoryRepository,
} from '../fixtures';

import type { EntityTarget, ObjectLiteral } from 'typeorm';

/**
 * **PRD C-16, end to end across the `person-photos` → `tryon` seam.**
 *
 * ### The bug this file exists to keep dead
 *
 * `person-photos` used to declare a `TRYON_CACHE_RETIREMENT` port and inject it with
 * `@Optional()`; `TryOnModule` bound and exported it. But `TryOnModule` imports
 * `PersonPhotosModule` — not the reverse — and Nest resolves a provider through the
 * *importing* module's injector, so the binding never reached `PersonPhotosService`.
 * C-16 retirement silently no-opped behind a `warn` on every deletion, and **every
 * unit test of it passed**: the service spec handed the constructor a mock and asserted
 * the mock had been called, which is precisely what an absent `@Optional()` dependency
 * makes unfalsifiable.
 *
 * So nothing here mocks the path under test. The real `ApiModule` graph is compiled and
 * **initialised**, the real `PersonPhotosService` deletes a real row, the real
 * `EventEmitter2` from `EventEmitterModule.forRoot()` delivers the event, the real
 * `PersonPhotoRemovedListener` handles it and the real `TryOnCacheService` deletes from
 * `tryon_cache`. Every assertion is about rows and bytes, never about a call.
 *
 * ### How this fails if the wiring regresses
 *
 * | Regression | What happens here |
 * | --- | --- |
 * | `PersonPhotoRemovedListener` dropped from `TryOnModule.providers` | rows survive → fail |
 * | `TryOnModule` no longer imported by `ApiModule` | rows survive → fail |
 * | `@OnEvent` removed, or its event name changed on one side | rows survive → fail |
 * | `PersonPhotosService` stops emitting, or emits inside the transaction | rows survive → fail |
 * | retirement widened to delete render bytes or `tryon_results` | C-28 assertions fail |
 *
 * Three tokens are substituted and no more: the TypeORM `DataSource` and its
 * `EntityManager` — the same two `test/boot/api-module.spec.ts` substitutes — plus
 * `StorageService`, because `remove()` deletes real objects and there is no
 * `STORAGE_ROOT` on this machine (CLAUDE.md).
 *
 * `test-env.ts` is tuned for unit tests and three of its values sit below what the real
 * §7 `validateEnv` accepts; they are raised for this file only, exactly as the boot test
 * documents.
 */
const BOOT_ENV: Readonly<Record<string, string>> = {
  API_PORT: '4000',
  ARGON2_MEMORY_KIB: '19456',
  SMTP_SECURE: 'false',
};

const OWNER = 'aaaaaaaa-1111-4222-8333-444455556666';
const REMOVED_PHOTO_HASH = 'a'.repeat(64);
const KEPT_PHOTO_HASH = 'b'.repeat(64);
const CANONICAL_RENDER_KEY = `renders/${OWNER}/render.png`;

/** Storage as a key → size map. Real §3.3 keys; `remove()` reads sizes for §9.3. */
class FakeStorage {
  readonly objects = new Map<string, number>();

  head = jest.fn((key: string): Promise<StoredObject | null> =>
    Promise.resolve(
      this.objects.has(key)
        ? {
            key,
            byteSize: this.objects.get(key) ?? 0,
            contentType: 'image/jpeg',
            etag: REMOVED_PHOTO_HASH,
            lastModified: new Date('2026-08-15T12:00:00.000Z'),
          }
        : null,
    ),
  );

  delete = jest.fn((key: string): Promise<boolean> => Promise.resolve(this.objects.delete(key)));

  signedUrl = jest.fn((key: string): string => `https://api.test/api/v1/files/${key}`);
}

let cacheRowSequence = 0;

function buildCacheEntry(overrides: Partial<TryOnCache> = {}): TryOnCache {
  cacheRowSequence += 1;
  return Object.assign(new TryOnCache(), {
    id: `cccccccc-1111-4222-8333-${String(cacheRowSequence).padStart(12, '0')}`,
    createdAt: new Date('2026-08-15T12:00:00.000Z'),
    updatedAt: new Date('2026-08-15T12:00:00.000Z'),
    deletedAt: null,
    cacheKey: String(cacheRowSequence).padStart(64, '0'),
    garmentSourceHash: 'e'.repeat(64),
    personPhotoHash: REMOVED_PHOTO_HASH,
    apiVersion: '2026-08-01',
    garmentId: null,
    // §3.7: the canonical copy is the requesting user's *own* render — the same file
    // her `tryon_results` row points at.
    storageKey: CANONICAL_RENDER_KEY,
    width: 1024,
    height: 1536,
    hitCount: 0,
    lastHitAt: null,
    ...overrides,
  });
}

describe('C-16 — deleting a photo really does retire its cache entries', () => {
  const originalEnv = new Map<string, string | undefined>();

  let moduleRef: TestingModule;
  let database: InMemoryDataSource;
  let storage: FakeStorage;
  let photos: PersonPhotosService;
  let events: EventEmitter2;

  const actor: ICurrentUser = {
    id: OWNER,
    role: Role.CONSUMER,
    email: 'farida@example.invalid',
    name: 'Farida',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    phoneVerifiedAt: null,
    sessionId: 'dddddddd-1111-4222-8333-444455556666',
    locale: 'EN' as ICurrentUser['locale'],
  };

  function repository<T extends ObjectLiteral & { id: string }>(
    entity: EntityTarget<T>,
  ): InMemoryRepository<T> {
    return database.dataSource.getRepository(entity) as unknown as InMemoryRepository<T>;
  }

  function survivingHashes(): string[] {
    return repository(TryOnCache).$rows.map((row) => row.personPhotoHash);
  }

  /**
   * The listener is `async: true`, so retirement lands a turn or two after `remove()`
   * returns — that is the point of it. Polling for the outcome rather than sleeping a
   * fixed amount keeps this honest *and* fast: it fails on "never happened", and the
   * bounded loop means a regression fails in milliseconds rather than hanging.
   */
  async function retirementToSettle(): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!survivingHashes().includes(REMOVED_PHOTO_HASH)) {
        return;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  beforeAll(async () => {
    for (const [key, value] of Object.entries(BOOT_ENV)) {
      originalEnv.set(key, process.env[key]);
      process.env[key] = value;
    }

    // Imported here so `ConfigModule.forRoot({ validate: validateEnv })` sees the
    // environment above at module-evaluation time.
    const { ApiModule } = await import('@api/api.module');

    database = createInMemoryDataSource();
    storage = new FakeStorage();

    moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(getDataSourceToken())
      .useValue(database.dataSource)
      .overrideProvider(getEntityManagerToken())
      .useValue(database.manager)
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();

    // `EventEmitterModule` binds every `@OnEvent` handler in a lifecycle hook, which
    // `compile()` alone does not run. This line *is* the application starting, and it
    // is the step the whole file turns on.
    await moduleRef.init();

    photos = moduleRef.get(PersonPhotosService, { strict: false });
    events = moduleRef.get(EventEmitter2, { strict: false });
  });

  afterAll(async () => {
    await moduleRef?.close();

    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(() => {
    const photo = buildPersonPhoto({ userId: OWNER, hash: REMOVED_PHOTO_HASH, isActive: true });

    repository(PersonPhoto).$seed([photo]);
    repository(TryOnCache).$seed([
      // Two entries from the photo she is about to delete — one per garment she tried.
      buildCacheEntry(),
      buildCacheEntry(),
      // One built from a photo she is keeping. It must survive.
      buildCacheEntry({ personPhotoHash: KEPT_PHOTO_HASH }),
    ]);
    repository(TryOnResult).$seed([buildTryOnResult({ userId: OWNER, personPhotoId: photo.id })]);

    storage.objects.clear();
    storage.objects.set(photo.storageKey, 842_133);
    if (photo.blurredThumbnailKey !== null) {
      storage.objects.set(photo.blurredThumbnailKey, 4_096);
    }
    storage.objects.set(CANONICAL_RENDER_KEY, 1_284_442);
  });

  function activePhoto(): PersonPhoto {
    return repository(PersonPhoto).$rows[0];
  }

  /* -----------------------------------------------------------------------------------
   * The wiring, proved by its effect
   * -------------------------------------------------------------------------------- */

  it('retires every cache entry built from the deleted photo, and only those', async () => {
    expect(survivingHashes()).toHaveLength(3);

    await photos.remove(actor, activePhoto().id);
    await retirementToSettle();

    expect(survivingHashes()).toEqual([KEPT_PHOTO_HASH]);
  });

  it('registers the listener in the real graph', () => {
    // Constructible *and* reachable from the composition root. On its own this proves
    // nothing about delivery — which is why the assertion above is about rows.
    expect(moduleRef.get(PersonPhotoRemovedListener, { strict: false })).toBeInstanceOf(
      PersonPhotoRemovedListener,
    );
  });

  it('is driven by the domain event, not by a call from person-photos', async () => {
    const seen: PersonPhotoRemovedEvent[] = [];
    const observer = (event: PersonPhotoRemovedEvent): void => {
      seen.push(event);
    };
    events.on(PERSON_PHOTO_EVENTS.REMOVED, observer);

    try {
      const photo = activePhoto();

      await photos.remove(actor, photo.id);
      await retirementToSettle();

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ personPhotoHash: REMOVED_PHOTO_HASH, photoId: photo.id });
      // The service holds no handle on the far side at all — no port, no token, no
      // method. That absence is what the old design could not have.
      expect('retireCacheEntriesFor' in photos).toBe(false);
    } finally {
      events.off(PERSON_PHOTO_EVENTS.REMOVED, observer);
    }
  });

  /* -----------------------------------------------------------------------------------
   * What retirement must not take with it
   * -------------------------------------------------------------------------------- */

  it('leaves the render row standing after its source photo is gone (C-28)', async () => {
    await photos.remove(actor, activePhoto().id);
    await retirementToSettle();

    const renders = repository(TryOnResult).$rows;
    expect(renders).toHaveLength(1);
    expect(renders[0].personPhotoLabelSnapshot).not.toBeNull();
  });

  it('leaves the render bytes on disk — retirement drops a pointer, never an object', async () => {
    // §3.7 makes `tryon_cache.storageKey` the requesting user's own render, the same
    // file her `tryon_results` row points at. Deleting it on retirement would destroy a
    // live render out of somebody's history (C-28, C-31), so a retired row leaves
    // nothing orphaned: it never owned an object. Only her photo and its blurred
    // moderation thumbnail go.
    const photo = activePhoto();

    await photos.remove(actor, photo.id);
    await retirementToSettle();

    expect(storage.objects.has(CANONICAL_RENDER_KEY)).toBe(true);
    expect(storage.delete).not.toHaveBeenCalledWith(CANONICAL_RENDER_KEY);
    expect(storage.delete).toHaveBeenCalledWith(photo.storageKey);
  });

  it('completes the deletion itself before retirement has run (C-38)', async () => {
    const photo = activePhoto();

    await photos.remove(actor, photo.id);

    // Her photograph and its bytes are gone the moment the call returns; the cache
    // sweep is still in flight. That ordering is the whole argument for an event: the
    // deletion cannot be delayed, or failed, by another module's table.
    expect(repository(PersonPhoto).$rows).toHaveLength(0);
    expect(storage.objects.has(photo.storageKey)).toBe(false);
    expect(survivingHashes()).toContain(REMOVED_PHOTO_HASH);

    await retirementToSettle();
    expect(survivingHashes()).toEqual([KEPT_PHOTO_HASH]);
  });
});
