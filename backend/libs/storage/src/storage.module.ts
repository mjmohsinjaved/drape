/**
 * ARCHITECTURE.md §3.1 — the driver is selected here and nowhere else.
 *
 * "Adding S3 means adding `s3.driver.ts` and one line in `storage.module.ts` — no call site
 * changes." That is the whole point of the `STORAGE_DRIVER_TOKEN` indirection: every consumer
 * injects `StorageService`, which injects the token, which resolves to whichever driver
 * `STORAGE_DRIVER` names.
 *
 * The module is `@Global()` so feature modules do not each re-import it — storage is infrastructure,
 * like the logger, not a domain dependency.
 */
import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';

import { LocalDiskDriver } from './drivers/local-disk.driver';
import { StorageConfigError } from './exceptions/storage.exception';
import { ImageService } from './image.service';
import { SignedUrlService } from './signed-url.service';
import {
  loadStorageConfig,
  STORAGE_CONFIG,
  STORAGE_DRIVER_TOKEN,
  type StorageConfig,
} from './storage.config';
import { StorageService } from './storage.service';

import type { StorageDriver } from './drivers/storage-driver.interface';

/** The one line that changes when `s3.driver.ts` arrives. */
function selectDriver(config: StorageConfig, localDisk: LocalDiskDriver): StorageDriver {
  switch (config.driver) {
    case 'local':
      return localDisk;
    case 's3':
      throw new StorageConfigError(
        "STORAGE_DRIVER='s3' is not implemented in V1. Add libs/storage/src/drivers/s3.driver.ts " +
          'and return it from selectDriver().',
      );
    default:
      throw new StorageConfigError('Unknown STORAGE_DRIVER.');
  }
}

function buildProviders(config?: StorageConfig): Provider[] {
  return [
    {
      provide: STORAGE_CONFIG,
      // §3.2 requirement 1 — resolved once, at module init. Throws at boot if the root is inside
      // the repository or a required variable is missing.
      useFactory: (): StorageConfig => config ?? loadStorageConfig(),
    },
    SignedUrlService,
    ImageService,
    LocalDiskDriver,
    {
      provide: STORAGE_DRIVER_TOKEN,
      useFactory: selectDriver,
      inject: [STORAGE_CONFIG, LocalDiskDriver],
    },
    StorageService,
  ];
}

const EXPORTS = [StorageService, ImageService, SignedUrlService, STORAGE_CONFIG];

@Global()
@Module({
  providers: buildProviders(),
  exports: EXPORTS,
})
export class StorageModule {
  /**
   * Explicit configuration, for tests and for a future host that composes its own config. Production
   * imports `StorageModule` directly and reads the environment (§7).
   */
  static forRoot(config: StorageConfig): DynamicModule {
    return {
      module: StorageModule,
      global: true,
      providers: buildProviders(config),
      exports: EXPORTS,
    };
  }
}
