import { type PersonPhotoRemovedEvent } from '@api/modules/person-photos';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { TryOnCache } from '../entities/tryon-cache.entity';
import {
  CONSUMER,
  CONSUMER_ID,
  createTryOnContext,
  GARMENT_ID,
  PHOTO_HASH,
  PHOTO_ID,
  REPLACEMENT_PHOTO_HASH,
  type TryOnTestContext,
} from '../testing/tryon-harness';

import { PersonPhotoRemovedListener } from './person-photo-removed.listener';

const GARMENT_SOURCE_HASH = 'a'.repeat(64);

function removedEvent(personPhotoHash: string): PersonPhotoRemovedEvent {
  return {
    userId: CONSUMER_ID,
    photoId: PHOTO_ID,
    personPhotoHash,
    wasActive: true,
    occurredAt: new Date('2026-08-15T12:00:00.000Z'),
  };
}

describe('PersonPhotoRemovedListener — C-16 retirement', () => {
  let context: TryOnTestContext;
  let listener: PersonPhotoRemovedListener;

  beforeEach(async () => {
    context = await createTryOnContext();
    listener = new PersonPhotoRemovedListener(context.cache);
  });

  afterEach(async () => {
    await context.close();
  });

  async function rememberRender(personPhotoHash: string, name: string): Promise<string> {
    const storageKey = `renders/${CONSUMER_ID}/${name}.png`;
    context.storage.objects.set(storageKey, Buffer.from('a-render'));
    await context.cache.remember({
      cacheKey: context.cache.buildKey(GARMENT_SOURCE_HASH, personPhotoHash, 'mock'),
      garmentSourceHash: GARMENT_SOURCE_HASH,
      personPhotoHash,
      garmentId: null,
      storageKey,
      width: 768,
      height: 1152,
      driver: 'mock',
    });
    return storageKey;
  }

  it('retires every entry built from the removed photo, and nothing else', async () => {
    await rememberRender(PHOTO_HASH, 'from-the-removed-photo');
    await rememberRender(REPLACEMENT_PHOTO_HASH, 'from-another-photo');

    await listener.onPersonPhotoRemoved(removedEvent(PHOTO_HASH));

    const rows = context.harness.repository<TryOnCache>(TryOnCache).$rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.personPhotoHash).toBe(REPLACEMENT_PHOTO_HASH);
  });

  it('leaves the render bytes on disk — the cache row is a pointer, not an owner', async () => {
    const storageKey = await rememberRender(PHOTO_HASH, 'hers');

    await listener.onPersonPhotoRemoved(removedEvent(PHOTO_HASH));

    expect(context.storage.objects.get(storageKey)).toBeDefined();
    expect(context.storage.delete).not.toHaveBeenCalled();
  });

  it('never touches tryon_results — a render survives its source photo (C-28)', async () => {
    await context.tryOn.create({ garmentId: GARMENT_ID, idempotencyKey: 'idem-c16' }, CONSUMER);
    const results = context.harness.repository<TryOnResult>(TryOnResult);
    expect(results.$rows).toHaveLength(1);

    await listener.onPersonPhotoRemoved(removedEvent(PHOTO_HASH));

    expect(results.$rows).toHaveLength(1);
    expect(context.harness.repository<TryOnCache>(TryOnCache).$rows).toHaveLength(0);
  });

  it('accepts a photo that was never tried on without complaint', async () => {
    await expect(
      listener.onPersonPhotoRemoved(removedEvent('f'.repeat(64))),
    ).resolves.toBeUndefined();
  });

  it('swallows a failing retirement rather than raising an unhandled rejection', async () => {
    await rememberRender(PHOTO_HASH, 'hers');
    const cache = context.harness.repository<TryOnCache>(TryOnCache);
    (cache.delete as unknown as jest.Mock).mockRejectedValueOnce(new Error('tryon_cache is down'));

    await expect(listener.onPersonPhotoRemoved(removedEvent(PHOTO_HASH))).resolves.toBeUndefined();
  });
});
