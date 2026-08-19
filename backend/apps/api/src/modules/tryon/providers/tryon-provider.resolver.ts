import { Injectable, Logger } from '@nestjs/common';

import { OpenAiImageQuality, TryOnDriverName } from '@api/config/env.validation';
import { SettingsService } from '@api/modules/settings';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { TryOnConfig } from '../config/tryon.config';

import { buildTryOnProviders, selectTryOnProvider } from './tryon-provider.factory';
import { type TryOnProvider } from './tryon-provider.interface';

export interface ResolvedTryOnProvider {
  readonly driver: TryOnDriverName;
  readonly provider: TryOnProvider;
}

export const TRYON_PROVIDER_RESOLVER = Symbol('TRYON_PROVIDER_RESOLVER');

function isDriverName(value: unknown): value is TryOnDriverName {
  return typeof value === 'string' && (Object.values(TryOnDriverName) as string[]).includes(value);
}

function isQuality(value: unknown): value is OpenAiImageQuality {
  return (
    typeof value === 'string' && (Object.values(OpenAiImageQuality) as string[]).includes(value)
  );
}

@Injectable()
export class TryOnProviderResolver {
  private readonly logger = new Logger(TryOnProviderResolver.name);

  private readonly providers: ReadonlyMap<TryOnDriverName, TryOnProvider>;

  private lastLoggedDriver: TryOnDriverName | null = null;

  constructor(
    private readonly config: TryOnConfig,
    private readonly settings: SettingsService,
  ) {
    this.providers = buildTryOnProviders(config, () => this.readOpenAiQuality());
  }

  async activeDriver(): Promise<TryOnDriverName> {
    const configured = await this.settings.getString(SETTINGS_KEYS.TRYON_DRIVER);

    if (configured === null || configured.length === 0) {
      return this.config.driver;
    }

    if (!isDriverName(configured)) {
      this.logger.error(
        `The "${SETTINGS_KEYS.TRYON_DRIVER}" setting holds "${configured}", which is not a ` +
          `known driver; falling back to the boot driver "${this.config.driver}".`,
      );
      return this.config.driver;
    }

    return configured;
  }

  async resolve(): Promise<ResolvedTryOnProvider> {
    const driver = await this.activeDriver();
    const provider = selectTryOnProvider(this.providers, driver);

    this.logSwitch(driver);

    return { driver, provider };
  }

  private async readOpenAiQuality(): Promise<OpenAiImageQuality> {
    const stored = await this.settings.getString(SETTINGS_KEYS.TRYON_OPENAI_QUALITY);
    if (isQuality(stored)) {
      return stored;
    }
    if (stored !== null && stored.length > 0) {
      this.logger.warn(
        `The "${SETTINGS_KEYS.TRYON_OPENAI_QUALITY}" setting holds an unrecognised value; ` +
          `using "${OpenAiImageQuality.MEDIUM}".`,
      );
    }
    return OpenAiImageQuality.MEDIUM;
  }

  private logSwitch(driver: TryOnDriverName): void {
    if (this.lastLoggedDriver === driver) {
      return;
    }
    this.lastLoggedDriver = driver;

    if (driver === TryOnDriverName.MOCK) {
      this.logger.log('Generations are being served by the mock driver — nothing is billed.');
      return;
    }

    this.logger.warn(
      `Generations are now being served by the "${driver}" driver, which bills a real ` +
        `account per render.`,
    );
  }
}
