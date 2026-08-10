import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { METRICS, MetricsService, buildTryOnCacheKey } from '@library/common';
import { StorageKeys, StorageService, isImageExt } from '@library/storage';

import { TryOnConfig } from '../config/tryon.config';
import { TryOnCache } from '../entities/tryon-cache.entity';

import type { RasterImageExt } from '@library/storage';

/**
 * The extension already on a stored render key, for a copy that must keep it.
 *
 * Falls back to `png` for a key with no recognisable extension. That cannot happen for a key
 * this system wrote — `StorageKeys.render` always appends one — and a copy is the wrong place
 * to start refusing renders that already exist on disk.
 */
function extOf(storageKey: string): RasterImageExt {
  const candidate = storageKey.slice(storageKey.lastIndexOf('.') + 1).toLowerCase();
  return isImageExt(candidate) && candidate !== 'svg' ? candidate : 'png';
}

/** A render copied into one user's namespace, ready to become a `tryon_results` row. */
export interface CopiedRender {
  /** `renders/<userId>/<uuid>.<ext>` — hers, not a reference to anyone else's file. */
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
}

/** A render to remember, once a generation has actually happened. */
export interface CacheWriteInput {
  readonly cacheKey: string;
  readonly garmentSourceHash: string;
  readonly personPhotoHash: string;
  readonly garmentId: string | null;
  /** The canonical copy. Per §3.7 this is the requesting user's own render. */
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
}

/**
 * **The content-hash cache — ARCHITECTURE §3.7, PRD §8.1 step 4, §8.4.**
 *
 * ```
 * cacheKey = sha256(`${garmentSourceHash}:${personPhotoHash}:${TRYON_API_VERSION}`)
 * ```
 *
 * This is the single largest cost control in the product. A consumer who re-opens a
 * past result, or tries the same piece on the same photo twice, never triggers a
 * generation (C-22, C-26), and a second consumer whose photo happens to hash the same
 * does not either.
 *
 * ### The cross-user copy, and why it is a copy
 *
 * §3.7 records the decision: **on a hit the render file is copied into the requesting
 * user's own namespace** (`renders/<userId>/<uuid>.png`) and she gets her own
 * `tryon_results` row. It is never shared by reference. Three things depend on that:
 *
 *  - **per-user deletion** (C-31, C-38) — deleting her render deletes *a* file, and it
 *    is hers. Sharing by reference would mean one consumer's "delete permanently" either
 *    lies or destroys someone else's history;
 *  - **`sub`-scoped signed URLs** (§3.4) — a render URL is issued against the owner's
 *    subject. A shared key would have to be issued to whoever asked, which is the same
 *    as not scoping it;
 *  - **account deletion** — §3.3 deletes `renders/<userId>/` wholesale. That is only
 *    safe if nothing outside the prefix points into it.
 *
 * The price is a file copy instead of a generation: microseconds and a few hundred
 * kilobytes, against seven seconds and a real charge.
 *
 * ### Retirement (C-16)
 *
 * Removing a photo retires its cache entries — every row whose `personPhotoHash`
 * matches is deleted. This is **hygiene, not correctness**: the key above already
 * contains `personPhotoHash`, so a try-on against a different photograph derives a
 * different key and cannot hit a render built from the old one whether or not the rows
 * were ever swept. It is driven by `PERSON_PHOTO_EVENTS.REMOVED` through
 * `PersonPhotoRemovedListener`, so `person-photos` never calls into this class.
 *
 * Renders already produced stay in history (C-28); this class never touches
 * `tryon_results`, and — see {@link TryOnCacheService.retireByPersonPhotoHash} — never
 * deletes the render bytes a retired row pointed at.
 */
@Injectable()
export class TryOnCacheService {
  private readonly logger = new Logger(TryOnCacheService.name);

  constructor(
    @InjectRepository(TryOnCache)
    private readonly cache: Repository<TryOnCache>,
    private readonly storage: StorageService,
    private readonly config: TryOnConfig,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * The §3.7 key. The component order is part of the contract and lives in
   * `@library/common`'s hash util, not here — changing it silently invalidates every
   * cached render, so it has exactly one home.
   */
  buildKey(garmentSourceHash: string, personPhotoHash: string): string {
    return buildTryOnCacheKey({
      garmentSourceHash,
      personPhotoHash,
      tryOnApiVersion: this.config.apiVersion,
    });
  }

  /**
   * Looks the key up and emits the E-13 hit/miss counter.
   *
   * The metric is emitted **here** rather than at the call site, so the cache hit rate
   * cannot silently stop being measured when a new caller appears.
   */
  async lookup(cacheKey: string): Promise<TryOnCache | null> {
    const entry = await this.cache.findOne({ where: { cacheKey } });

    this.metrics.increment(entry === null ? METRICS.TRYON_CACHE_MISS : METRICS.TRYON_CACHE_HIT);

    return entry;
  }

  /**
   * Copies a cached render into `userId`'s namespace and records the hit.
   *
   * The `hitCount` bump is best-effort and deliberately not transactional with the
   * copy: a lost counter is a slightly wrong analytics number, while a failed copy that
   * rolled back a counter would be a consumer staring at an error for a render that
   * exists. The copy is what has to be right.
   */
  async copyForUser(entry: TryOnCache, userId: string): Promise<CopiedRender> {
    // The copy is byte for byte, so the destination must carry the source's extension. Naming
    // it `.png` regardless — which is what the old fixed-extension key builder did — would put
    // a JPEG behind a `.png` key on every cache hit, and TryOnCloud returns JPEG.
    const destination = StorageKeys.render(userId, extOf(entry.storageKey));
    const copied = await this.storage.copy(entry.storageKey, destination);

    await this.cache.update(
      { id: entry.id },
      { hitCount: entry.hitCount + 1, lastHitAt: new Date() },
    );

    this.logger.debug(`Served a cached render from a copy into the requester's namespace.`);

    return {
      storageKey: copied.key,
      width: entry.width,
      height: entry.height,
      byteSize: copied.size,
    };
  }

  /**
   * Remembers a freshly generated render.
   *
   * Best-effort by design: the render is already stored and the consumer already has
   * it, so a cache write that loses a race with another request for the same key must
   * cost the next generation, not this response. The unique index on `cacheKey` is what
   * makes the race safe to swallow.
   */
  async remember(input: CacheWriteInput): Promise<void> {
    try {
      await this.cache.insert(
        this.cache.create({
          cacheKey: input.cacheKey,
          garmentSourceHash: input.garmentSourceHash,
          personPhotoHash: input.personPhotoHash,
          apiVersion: this.config.apiVersion,
          garmentId: input.garmentId,
          storageKey: input.storageKey,
          width: input.width,
          height: input.height,
          hitCount: 0,
          lastHitAt: null,
        }),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Could not write the cache entry; the next identical try-on will regenerate. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * C-16 — retire every entry produced from a photo that has been replaced or removed.
   *
   * Reached from `PersonPhotoRemovedListener`, never from `person-photos` directly.
   * Renders already produced from the photo are untouched: they live in `tryon_results`
   * and survive it (C-28, §4.18).
   *
   * ### The row goes; the bytes stay, deliberately
   *
   * §3.7 makes the canonical copy **the requesting user's own render** — `storageKey`
   * here is the same `renders/<userId>/<uuid>.png` her `tryon_results` row points at
   * (see `TryOnRunnerService.generate`, which passes `render.storageKey` straight into
   * `remember()`). Deleting it on retirement would delete a live render out of
   * somebody's history and break C-28 and C-31. So retirement drops a *pointer*, never
   * an object: the render's lifecycle belongs to its owner, and it is removed when she
   * deletes it (C-31, §4.18) or when §3.3 drops `renders/<userId>/` on account
   * deletion. A retired cache row leaves nothing orphaned, because it never owned
   * anything.
   *
   * @returns how many entries were retired.
   */
  async retireByPersonPhotoHash(personPhotoHash: string): Promise<number> {
    const result = await this.cache.delete({ personPhotoHash });
    const retired = result.affected ?? 0;

    if (retired > 0) {
      this.metrics.increment(METRICS.TRYON_CACHE_EVICTED, {}, retired);
      this.logger.log(`Retired ${retired} cache entries for a replaced or removed photo (C-16).`);
    }

    return retired;
  }
}
