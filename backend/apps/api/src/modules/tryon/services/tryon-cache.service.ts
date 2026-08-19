import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { METRICS, MetricsService, buildTryOnCacheKey } from '@library/common';
import { StorageKeys, StorageService, isImageExt } from '@library/storage';
import type { RasterImageExt } from '@library/storage';

import { TryOnConfig } from '../config/tryon.config';
import { TryOnCache } from '../entities/tryon-cache.entity';

function extOf(storageKey: string): RasterImageExt {
  const candidate = storageKey.slice(storageKey.lastIndexOf('.') + 1).toLowerCase();
  return isImageExt(candidate) && candidate !== 'svg' ? candidate : 'png';
}

export interface CopiedRender {
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
}

export interface CacheWriteInput {
  readonly cacheKey: string;
  readonly garmentSourceHash: string;
  readonly personPhotoHash: string;
  readonly garmentId: string | null;
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
  readonly driver: string;
}

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

  buildKey(garmentSourceHash: string, personPhotoHash: string, driver: string): string {
    return buildTryOnCacheKey({
      garmentSourceHash,
      personPhotoHash,
      tryOnApiVersion: this.config.apiVersion,
      driver,
    });
  }

  async lookup(cacheKey: string): Promise<TryOnCache | null> {
    const entry = await this.cache.findOne({ where: { cacheKey } });

    this.metrics.increment(entry === null ? METRICS.TRYON_CACHE_MISS : METRICS.TRYON_CACHE_HIT);

    return entry;
  }

  async copyForUser(entry: TryOnCache, userId: string): Promise<CopiedRender> {
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

  async remember(input: CacheWriteInput): Promise<void> {
    try {
      await this.cache.insert(
        this.cache.create({
          cacheKey: input.cacheKey,
          garmentSourceHash: input.garmentSourceHash,
          personPhotoHash: input.personPhotoHash,
          apiVersion: this.config.apiVersion,
          driver: input.driver,
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
