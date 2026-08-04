import { StorageKeys } from '@library/storage';

import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';

import { FIXED_NOW } from '../setup/time';

import { buildEntity, hash64, nextSequence, uuid } from './factory.support';

/**
 * `tryon_results` (§4.18) — "the critical table. C-24 through C-31 all rest on it."
 *
 * All four foreign keys are nullable with `ON DELETE SET NULL`, and the snapshot columns are
 * what make that survivable: **the history list renders exclusively from the snapshots** and
 * does not join `garments` (C-29). So the snapshots are populated here even when the
 * corresponding id is present — a fixture with a garmentId but an empty
 * `garmentTitleSnapshot` would let a broken history query pass.
 *
 * `buildOrphanedTryOnResult()` is the C-28/C-29 case worth testing most: the photo and the
 * garment are gone, and the row must still render.
 */
export function buildTryOnResult(overrides: Partial<TryOnResult> = {}): TryOnResult {
  const sequence = nextSequence();
  const userId = overrides.userId ?? uuid();

  return buildEntity<TryOnResult>(
    TryOnResult,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      jobId: uuid(),
      userId,
      garmentId: uuid(),
      personPhotoId: uuid(),

      // The unwatermarked render. The C-23 watermark is composited at download time only.
      storageKey: StorageKeys.render(userId),
      thumbnailKey: StorageKeys.thumbnail('render'),
      cacheKey: hash64(`result-cache-${sequence}`),

      garmentTitleSnapshot: `Test Garment ${sequence}`,
      garmentCategorySnapshot: 'Bridal Lehenga',
      garmentPriceSnapshot: 185_000,
      garmentCurrencySnapshot: 'PKR',
      // Lets C-30 grouping survive deletion of the photo it came from.
      personPhotoLabelSnapshot: `daylight ${sequence}`,

      isTestRender: false,
      width: 1024,
      height: 1536,
      byteSize: 1_284_442,
      // §9.3: brand marketing use requires a per-render explicit opt-in. Never default it on.
      marketingOptInAt: null,
    },
    overrides,
  );
}

/**
 * C-28 and C-29 together: the photo was deleted and the garment hard-removed, both FKs are
 * null, and the row must still render from its snapshots alone.
 */
export function buildOrphanedTryOnResult(overrides: Partial<TryOnResult> = {}): TryOnResult {
  return buildTryOnResult({
    jobId: null,
    garmentId: null,
    personPhotoId: null,
    ...overrides,
  });
}

/** The render produced by an admin's A-11 test render, stored against the garment. */
export function buildTestRenderResult(overrides: Partial<TryOnResult> = {}): TryOnResult {
  return buildTryOnResult({ isTestRender: true, personPhotoId: null, ...overrides });
}
