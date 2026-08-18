import { buildTryOnCacheKey } from '@library/common';

import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { TryOnCache } from '../entities/tryon-cache.entity';
import {
  CONSUMER,
  CONSUMER_ID,
  createTryOnContext,
  GARMENT_ID,
  OTHER_CONSUMER_ID,
  PHOTO_HASH,
  REPLACEMENT_PHOTO_HASH,
  type TryOnTestContext,
} from '../testing/tryon-harness';

const GARMENT_SOURCE_HASH = 'a'.repeat(64);

const DRIVER = 'mock';

describe('TryOnCacheService', () => {
  let context: TryOnTestContext;

  afterEach(async () => {
    await context.close();
  });

  describe('the §3.7 key', () => {
    it('is sha256(garmentSourceHash:personPhotoHash:TRYON_API_VERSION:driver)', async () => {
      context = await createTryOnContext();

      expect(context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER)).toBe(
        buildTryOnCacheKey({
          garmentSourceHash: GARMENT_SOURCE_HASH,
          personPhotoHash: PHOTO_HASH,
          tryOnApiVersion: 'test-0000-00-00',
          driver: DRIVER,
        }),
      );
    });

    it('changes when the A-33 driver changes, so a switch is not served the old renders', async () => {
      context = await createTryOnContext();

      expect(context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, 'openai')).not.toBe(
        context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, 'gemini'),
      );
    });

    it('changes when the photo changes — C-16 retirement’s reason for existing', async () => {
      context = await createTryOnContext();

      expect(context.cache.buildKey(GARMENT_SOURCE_HASH, REPLACEMENT_PHOTO_HASH, DRIVER)).not.toBe(
        context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER),
      );
    });

    it('changes when TRYON_API_VERSION is bumped, invalidating the cache with no migration', async () => {
      context = await createTryOnContext();
      const before = context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER);
      await context.close();

      context = await createTryOnContext({ env: { TRYON_API_VERSION: 'test-9999-99-99' } });

      expect(context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER)).not.toBe(before);
    });

    it('is order-sensitive: swapping the two hashes is a different key', async () => {
      context = await createTryOnContext();

      expect(context.cache.buildKey(PHOTO_HASH, GARMENT_SOURCE_HASH, DRIVER)).not.toBe(
        context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER),
      );
    });
  });

  describe('the cross-user copy (§3.7)', () => {
    async function seedEntry(): Promise<TryOnCache> {
      const entry = Object.assign(new TryOnCache(), {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        cacheKey: context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER),
        garmentSourceHash: GARMENT_SOURCE_HASH,
        personPhotoHash: PHOTO_HASH,
        apiVersion: 'test-0000-00-00',
        garmentId: null,
        storageKey: `renders/${CONSUMER_ID}/original.png`,
        width: 768,
        height: 1152,
        driver: DRIVER,
        hitCount: 0,
        lastHitAt: null,
        deletedAt: null,
      }) as TryOnCache;

      context.harness.repository<TryOnCache>(TryOnCache).$seed([entry]);
      context.storage.objects.set(entry.storageKey, Buffer.from('the-canonical-render'));
      return entry;
    }

    it('writes the render into the requesting user’s own namespace, not a shared one', async () => {
      context = await createTryOnContext();
      const entry = await seedEntry();

      const copied = await context.cache.copyForUser(entry, OTHER_CONSUMER_ID);

      expect(copied.storageKey).toContain(`renders/${OTHER_CONSUMER_ID}/`);
      expect(copied.storageKey).not.toBe(entry.storageKey);
    });

    it('leaves the original untouched, so one consumer’s deletion cannot destroy another’s', async () => {
      context = await createTryOnContext();
      const entry = await seedEntry();

      const copied = await context.cache.copyForUser(entry, OTHER_CONSUMER_ID);

      expect(context.storage.objects.get(entry.storageKey)).toBeDefined();
      expect(context.storage.objects.get(copied.storageKey)?.toString()).toBe(
        'the-canonical-render',
      );
    });

    it('records the hit so the E-13 cache-hit rate is real', async () => {
      context = await createTryOnContext();
      const entry = await seedEntry();

      await context.cache.copyForUser(entry, OTHER_CONSUMER_ID);

      const [row] = context.harness.repository<TryOnCache>(TryOnCache).$rows;
      expect(row?.hitCount).toBe(1);
      expect(row?.lastHitAt).toBeInstanceOf(Date);
    });
  });

  describe('retirement on photo replacement (C-16)', () => {
    it('retires every entry built from the removed photo’s hash', async () => {
      context = await createTryOnContext();
      const cache = context.harness.repository<TryOnCache>(TryOnCache);

      await context.cache.remember({
        cacheKey: context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER),
        garmentSourceHash: GARMENT_SOURCE_HASH,
        personPhotoHash: PHOTO_HASH,
        garmentId: null,
        storageKey: `renders/${CONSUMER_ID}/one.png`,
        width: 768,
        height: 1152,
        driver: DRIVER,
      });
      await context.cache.remember({
        cacheKey: context.cache.buildKey('e'.repeat(64), PHOTO_HASH, DRIVER),
        garmentSourceHash: 'e'.repeat(64),
        personPhotoHash: PHOTO_HASH,
        garmentId: null,
        storageKey: `renders/${CONSUMER_ID}/two.png`,
        width: 768,
        height: 1152,
        driver: DRIVER,
      });
      await context.cache.remember({
        cacheKey: context.cache.buildKey(GARMENT_SOURCE_HASH, REPLACEMENT_PHOTO_HASH, DRIVER),
        garmentSourceHash: GARMENT_SOURCE_HASH,
        personPhotoHash: REPLACEMENT_PHOTO_HASH,
        garmentId: null,
        storageKey: `renders/${CONSUMER_ID}/three.png`,
        width: 768,
        height: 1152,
        driver: DRIVER,
      });

      const retired = await context.cache.retireByPersonPhotoHash(PHOTO_HASH);

      expect(retired).toBe(2);
      expect(cache.$rows).toHaveLength(1);
      expect(cache.$rows[0]?.personPhotoHash).toBe(REPLACEMENT_PHOTO_HASH);
    });

    it('reports zero for a photo that was never tried on, rather than failing', async () => {
      context = await createTryOnContext();

      await expect(context.cache.retireByPersonPhotoHash('f'.repeat(64))).resolves.toBe(0);
    });

    it('never touches tryon_results — renders already produced stay in history (C-28)', async () => {
      context = await createTryOnContext();
      await context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-c16' }, CONSUMER);

      const results = context.harness.repository<TryOnResult>(TryOnResult);
      expect(results.$rows).toHaveLength(1);

      await context.cache.retireByPersonPhotoHash(PHOTO_HASH);

      expect(results.$rows).toHaveLength(1);
      expect(context.harness.repository<TryOnCache>(TryOnCache).$rows).toHaveLength(0);
    });
  });

  describe('remembering a render', () => {
    it('is best-effort: a failed cache write never fails the generation', async () => {
      context = await createTryOnContext();
      const cache = context.harness.repository<TryOnCache>(TryOnCache);
      (cache.insert as unknown as jest.Mock).mockRejectedValueOnce(new Error('unique violation'));

      await expect(
        context.cache.remember({
          cacheKey: context.cache.buildKey(GARMENT_SOURCE_HASH, PHOTO_HASH, DRIVER),
          garmentSourceHash: GARMENT_SOURCE_HASH,
          personPhotoHash: PHOTO_HASH,
          garmentId: null,
          storageKey: `renders/${CONSUMER_ID}/one.png`,
          width: 768,
          height: 1152,
          driver: DRIVER,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
