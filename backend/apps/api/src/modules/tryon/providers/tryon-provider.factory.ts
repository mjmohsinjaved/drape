import { Logger, type Provider } from '@nestjs/common';

import { TryOnDriverName } from '@api/config/env.validation';

import { TryOnConfig } from '../config/tryon.config';

import { HttpTryOnProvider } from './http-tryon.provider';
import { MockTryOnProvider } from './mock-tryon.provider';
import { TRYON_PROVIDER, type TryOnProvider } from './tryon-provider.interface';

const logger = new Logger('TryOnProviderFactory');

/**
 * **The one place a try-on driver is chosen.** ARCHITECTURE §7, PRD B-1.
 *
 * `TryOnService` injects `TRYON_PROVIDER` and has no idea which implementation it got.
 * That matters more here than in most seams, because the wrong answer costs real money
 * from a ten-image allowance — so the decision is made once, from one variable, and is
 * asserted by a test that runs on every CI build.
 *
 * `mock` is the default *and* the fallback: an unrecognised value selects the mock and
 * logs it loudly rather than guessing at the expensive option. `validateEnv()` already
 * rejects anything outside the enum before the container is built, so this branch is
 * unreachable in practice and exists so that it stays unreachable in the cheap
 * direction if it ever is not.
 */
export function createTryOnProvider(config: TryOnConfig): TryOnProvider {
  if (config.driver === TryOnDriverName.HTTP) {
    logger.warn(
      'TRYON_DRIVER=http — generations will call TryOnCloud and spend the upstream budget.',
    );
    return new HttpTryOnProvider(config);
  }

  if (config.driver !== TryOnDriverName.MOCK) {
    logger.error(
      `Unrecognised TRYON_DRIVER "${String(config.driver)}"; falling back to the mock driver.`,
    );
  }

  return new MockTryOnProvider(config);
}

/** The `TRYON_PROVIDER` binding, ready for `TryOnModule.providers`. */
export const tryOnProviderFactory: Provider = {
  provide: TRYON_PROVIDER,
  inject: [TryOnConfig],
  useFactory: createTryOnProvider,
};
