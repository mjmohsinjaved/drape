import { Logger } from '@nestjs/common';

import { OpenAiImageQuality, TryOnDriverName } from '@api/config/env.validation';

import { type TryOnConfig } from '../config/tryon.config';

import { GeminiTryOnProvider } from './gemini-tryon.provider';
import { HttpTryOnProvider } from './http-tryon.provider';
import { MockTryOnProvider } from './mock-tryon.provider';
import { OpenAiTryOnProvider } from './openai-tryon.provider';
import { type TryOnProvider } from './tryon-provider.interface';

const logger = new Logger('TryOnProviderFactory');

export type QualityReader = () => Promise<OpenAiImageQuality>;

const DEFAULT_QUALITY: QualityReader = () => Promise.resolve(OpenAiImageQuality.MEDIUM);

export function buildTryOnProviders(
  config: TryOnConfig,
  readQuality: QualityReader = DEFAULT_QUALITY,
): ReadonlyMap<TryOnDriverName, TryOnProvider> {
  return new Map<TryOnDriverName, TryOnProvider>([
    [TryOnDriverName.MOCK, new MockTryOnProvider(config)],
    [TryOnDriverName.HTTP, new HttpTryOnProvider(config)],
    [TryOnDriverName.GEMINI, new GeminiTryOnProvider(config)],
    [TryOnDriverName.OPENAI, new OpenAiTryOnProvider(config, readQuality)],
  ]);
}

export function selectTryOnProvider(
  providers: ReadonlyMap<TryOnDriverName, TryOnProvider>,
  driver: TryOnDriverName,
): TryOnProvider {
  const provider = providers.get(driver);
  if (provider !== undefined) {
    return provider;
  }

  logger.error(`Unrecognised try-on driver "${String(driver)}"; falling back to the mock driver.`);

  return providers.get(TryOnDriverName.MOCK) as TryOnProvider;
}

export function createTryOnProvider(
  config: TryOnConfig,
  readQuality: QualityReader = DEFAULT_QUALITY,
): TryOnProvider {
  const provider = selectTryOnProvider(buildTryOnProviders(config, readQuality), config.driver);

  switch (provider.name) {
    case 'http':
      logger.warn(
        'TRYON_DRIVER=http — generations will call TryOnCloud and spend the upstream budget.',
      );
      break;
    case 'gemini':
      logger.warn(
        `TRYON_DRIVER=gemini — generations will call the Gemini API ` +
          `(${config.geminiModel ?? 'no model configured'}) and bill the Google project.`,
      );
      break;
    case 'openai':
      logger.warn(
        `TRYON_DRIVER=openai — generations will call the OpenAI images API ` +
          `(${config.openAiModel ?? 'no model configured'}) and bill the OpenAI account.`,
      );
      break;
    default:
      break;
  }

  return provider;
}
