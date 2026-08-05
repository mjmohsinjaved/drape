/**
 * PRD C-31, §3.7, §4.19 — the dangling `tryon_cache` pointer the try-on engineer flagged.
 *
 * ### The bug this closes
 *
 * §3.7 makes the canonical cached render **the requesting user's own file**:
 * `tryon_cache.storageKey` is the very `renders/<userId>/<uuid>.png` her `tryon_results`
 * row points at. When she deletes an individual render (C-31), `ResultsService.remove()`
 * soft-deletes the row and hard-deletes the file — and the cache row survives, now
 * naming bytes that do not exist. The next consumer whose photograph hashes the same
 * gets a "hit", the copy fails against a missing object, and her generation breaks for a
 * reason that has nothing to do with her.
 *
 * ### The precision that matters
 *
 * The predicate is `cacheKey` **and** `storageKey`. Two consumers with byte-identical
 * photographs derive the same §3.7 key, but the cache row names exactly one canonical
 * file. Retiring on `cacheKey` alone would drop a good row whose bytes belong to
 * somebody else and cost that person a regeneration. Both assertions are below.
 */
import { AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from '@api/shared/constants/audit-actions.constant';

import { createInMemoryRepository } from '../../../../test/fixtures';

import { RenderDeletedListener } from './render-deleted.listener';

import type { InMemoryRepository } from '../../../../test/fixtures';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const HERS = 'aaaaaaaa-1111-4222-8333-444455556666';
const SOMEBODY_ELSE = 'bbbbbbbb-1111-4222-8333-444455556666';

const RESULT_ID = '50000000-0000-4000-8000-000000000001';
const SHARED_CACHE_KEY = 'c'.repeat(64);
const HER_RENDER_KEY = `renders/${HERS}/${RESULT_ID}.png`;
const THEIR_RENDER_KEY = `renders/${SOMEBODY_ELSE}/50000000-0000-4000-8000-000000000002.png`;

function deletedRender(overrides: Partial<TryOnResult> = {}): TryOnResult {
  return Object.assign(new TryOnResult(), {
    id: RESULT_ID,
    createdAt: NOW,
    updatedAt: NOW,
    // C-31 soft-deletes the row and hard-deletes the file. The row is still the only
    // thing that knows which key the deleted bytes answered to.
    deletedAt: NOW,
    jobId: null,
    userId: HERS,
    garmentId: null,
    personPhotoId: null,
    storageKey: HER_RENDER_KEY,
    thumbnailKey: null,
    cacheKey: SHARED_CACHE_KEY,
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
    ...overrides,
  });
}

function cacheRow(storageKey: string, id = '1'): TryOnCache {
  return Object.assign(new TryOnCache(), {
    id: `a0000000-0000-4000-8000-00000000000${id}`,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    cacheKey: SHARED_CACHE_KEY,
    garmentSourceHash: 'f'.repeat(64),
    personPhotoHash: 'b'.repeat(64),
    apiVersion: '2026-08-01',
    garmentId: null,
    storageKey,
    width: 1024,
    height: 1536,
    hitCount: 3,
    lastHitAt: NOW,
  });
}

interface Harness {
  readonly listener: RenderDeletedListener;
  readonly cache: InMemoryRepository<TryOnCache>;
  readonly results: InMemoryRepository<TryOnResult>;
}

function build(options: { cache?: TryOnCache[]; results?: TryOnResult[] } = {}): Harness {
  const cache = createInMemoryRepository<TryOnCache>({ rows: options.cache ?? [] });
  const results = createInMemoryRepository<TryOnResult>({ rows: options.results ?? [] });
  return { listener: new RenderDeletedListener(cache, results), cache, results };
}

/** The event `ResultsService.remove()` actually emits after the commit. */
function renderDeletedEvent(targetId: string = RESULT_ID): AuditRecordEvent {
  return new AuditRecordEvent({
    action: AUDIT_ACTIONS.TRYON_RESULT_DELETED,
    targetType: AUDIT_TARGET_TYPES.TRYON_RESULT,
    actorId: HERS,
    targetId,
    targetLabel: 'Anarkali in ivory',
  });
}

describe('RenderDeletedListener', () => {
  describe('the gap it closes (C-31, §3.7)', () => {
    it('retires the cache row that pointed at the deleted render', async () => {
      const harness = build({
        cache: [cacheRow(HER_RENDER_KEY)],
        results: [deletedRender()],
      });

      await harness.listener.onAuditRecord(renderDeletedEvent());

      // Without this, the next consumer whose photo hashes the same gets a hit against
      // bytes that no longer exist.
      expect(harness.cache.$rows).toHaveLength(0);
    });

    it('reads the soft-deleted row, which is the only thing that still knows the keys', async () => {
      const harness = build({
        cache: [cacheRow(HER_RENDER_KEY)],
        results: [deletedRender()],
      });

      await harness.listener.onAuditRecord(renderDeletedEvent());

      expect(harness.results.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });
  });

  describe('precision — the row must point at *her* file', () => {
    it("leaves a row with the same cacheKey whose canonical copy is somebody else's", async () => {
      const theirs = cacheRow(THEIR_RENDER_KEY, '2');
      const harness = build({ cache: [theirs], results: [deletedRender()] });

      const retired = await harness.listener.retireFor(RESULT_ID);

      // Same §3.7 key — two consumers uploaded byte-identical photographs — but the
      // canonical object is theirs. Retiring it would cost them a regeneration for
      // bytes that are still there.
      expect(retired).toBe(0);
      expect(harness.cache.$rows).toHaveLength(1);
      expect(harness.cache.$rows[0].id).toBe(theirs.id);
    });

    it('retires hers and leaves theirs when both rows exist', async () => {
      const hers = cacheRow(HER_RENDER_KEY, '1');
      const theirs = cacheRow(THEIR_RENDER_KEY, '2');
      const harness = build({ cache: [hers, theirs], results: [deletedRender()] });

      const retired = await harness.listener.retireFor(RESULT_ID);

      expect(retired).toBe(1);
      expect(harness.cache.$rows.map((row) => row.id)).toEqual([theirs.id]);
    });

    it('retires nothing for a render that was never cached — the common case', async () => {
      const harness = build({ cache: [], results: [deletedRender()] });

      await expect(harness.listener.retireFor(RESULT_ID)).resolves.toBe(0);
    });
  });

  describe('it reacts only to a render deletion', () => {
    it('ignores every other audit action', async () => {
      const harness = build({
        cache: [cacheRow(HER_RENDER_KEY)],
        results: [deletedRender()],
      });

      await harness.listener.onAuditRecord(
        new AuditRecordEvent({
          action: AUDIT_ACTIONS.PERSON_PHOTO_DELETED,
          targetType: AUDIT_TARGET_TYPES.PERSON_PHOTO,
          targetId: RESULT_ID,
        }),
      );

      expect(harness.cache.$rows).toHaveLength(1);
      expect(harness.results.findOne).not.toHaveBeenCalled();
    });

    it('ignores a render-deleted event with no target id', async () => {
      const harness = build({ cache: [cacheRow(HER_RENDER_KEY)] });

      await harness.listener.onAuditRecord(
        new AuditRecordEvent({
          action: AUDIT_ACTIONS.TRYON_RESULT_DELETED,
          targetType: AUDIT_TARGET_TYPES.TRYON_RESULT,
        }),
      );

      expect(harness.cache.$rows).toHaveLength(1);
    });

    it('does nothing when the render row is gone entirely', async () => {
      const harness = build({ cache: [cacheRow(HER_RENDER_KEY)], results: [] });

      await expect(harness.listener.retireFor(RESULT_ID)).resolves.toBe(0);
      expect(harness.cache.$rows).toHaveLength(1);
    });
  });

  describe('it never throws into the emitter', () => {
    it('swallows a repository failure — a stale pointer is the pre-existing condition', async () => {
      const harness = build({ results: [deletedRender()] });
      // Spied rather than reached through the repository type: `InMemoryRepository<T>`
      // is typed as `Repository<T>`, so the jest-mock methods are not visible on it.
      jest
        .spyOn(harness.cache, 'delete')
        .mockRejectedValue(new Error('tryon_cache is unreachable'));

      // `EventEmitterModule` runs with `ignoreErrors: false`, so an escaping rejection
      // would be an unhandled rejection in a process that just served a successful
      // deletion.
      await expect(harness.listener.onAuditRecord(renderDeletedEvent())).resolves.toBeUndefined();
    });
  });
});
