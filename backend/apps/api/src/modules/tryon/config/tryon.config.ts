import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_OPENAI_TIMEOUT_MS,
  TRYON_DRIVER_NAMES,
  TryOnDriverName,
} from '@api/config/env.validation';

export const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export { DEFAULT_OPENAI_TIMEOUT_MS };

function present(value: string | null): boolean {
  return value !== null && value.length > 0;
}

@Injectable()
export class TryOnConfig {
  readonly driver: TryOnDriverName;

  readonly apiVersion: string;

  readonly timeoutMs: number;

  readonly maxAttempts: number;

  readonly maxResponseBytes: number;

  readonly backoffBaseMs: number;

  readonly testRenderConcurrency: number;

  readonly mockLatencyMs: number;

  readonly mockFailureRate: number;

  readonly ratePerHour: number;

  readonly ratePerIpHour: number;

  readonly openAiTimeoutMs: number;

  private readonly baseUrlValue: string | null;

  private readonly geminiBaseUrlValue: string | null;

  private readonly geminiModelValue: string | null;

  private readonly openAiBaseUrlValue: string | null;

  private readonly openAiModelValue: string | null;

  private readonly apiKeys: ReadonlyMap<TryOnDriverName, string>;

  constructor(config: ConfigService) {
    this.driver = config.getOrThrow<TryOnDriverName>('TRYON_DRIVER');
    this.apiVersion = config.getOrThrow<string>('TRYON_API_VERSION');
    this.timeoutMs = config.getOrThrow<number>('TRYON_TIMEOUT_MS');
    this.maxAttempts = config.getOrThrow<number>('TRYON_MAX_ATTEMPTS');
    this.maxResponseBytes = TryOnConfig.readByteCap(
      config.get<string | number>('TRYON_MAX_RESPONSE_BYTES'),
    );
    this.backoffBaseMs = config.getOrThrow<number>('TRYON_BACKOFF_BASE_MS');
    this.testRenderConcurrency = config.getOrThrow<number>('TRYON_TEST_RENDER_CONCURRENCY');
    this.mockLatencyMs = config.getOrThrow<number>('TRYON_MOCK_LATENCY_MS');
    this.mockFailureRate = config.getOrThrow<number>('TRYON_MOCK_FAILURE_RATE');
    this.ratePerHour = config.getOrThrow<number>('TRYON_RATE_PER_HOUR');
    this.ratePerIpHour = config.getOrThrow<number>('TRYON_RATE_PER_IP_HOUR');

    this.openAiTimeoutMs = TryOnConfig.readTimeout(
      config.get<string | number>('TRYON_OPENAI_TIMEOUT_MS'),
      DEFAULT_OPENAI_TIMEOUT_MS,
    );

    this.baseUrlValue = config.get<string>('TRYONCLOUD_BASE_URL') ?? null;
    this.geminiBaseUrlValue = config.get<string>('GEMINI_BASE_URL') ?? null;
    this.geminiModelValue = config.get<string>('GEMINI_IMAGE_MODEL') ?? null;
    this.openAiBaseUrlValue = config.get<string>('OPENAI_BASE_URL') ?? null;
    this.openAiModelValue = config.get<string>('OPENAI_IMAGE_MODEL') ?? null;

    const keys = new Map<TryOnDriverName, string>();
    for (const [driver, raw] of [
      [TryOnDriverName.HTTP, config.get<string>('TRYONCLOUD_API_KEY')],
      [TryOnDriverName.GEMINI, config.get<string>('GEMINI_API_KEY')],
      [TryOnDriverName.OPENAI, config.get<string>('OPENAI_API_KEY')],
    ] as const) {
      if (typeof raw === 'string' && raw.length > 0) {
        keys.set(driver, raw);
      }
    }
    this.apiKeys = keys;
  }

  get isHttpDriver(): boolean {
    return this.driver === TryOnDriverName.HTTP;
  }

  get baseUrl(): string | null {
    return this.baseUrlValue;
  }

  readApiKey(driver: TryOnDriverName): string | null {
    return this.apiKeys.get(driver) ?? null;
  }

  timeoutMsFor(driver: TryOnDriverName): number {
    return driver === TryOnDriverName.OPENAI ? this.openAiTimeoutMs : this.timeoutMs;
  }

  isDriverUsable(driver: TryOnDriverName): boolean {
    switch (driver) {
      case TryOnDriverName.MOCK:
        return true;
      case TryOnDriverName.HTTP:
        return present(this.baseUrlValue) && this.apiKeys.has(TryOnDriverName.HTTP);
      case TryOnDriverName.GEMINI:
        return (
          present(this.geminiBaseUrlValue) &&
          present(this.geminiModelValue) &&
          this.apiKeys.has(TryOnDriverName.GEMINI)
        );
      case TryOnDriverName.OPENAI:
        return (
          present(this.openAiBaseUrlValue) &&
          present(this.openAiModelValue) &&
          this.apiKeys.has(TryOnDriverName.OPENAI)
        );
      /* istanbul ignore next — TryOnDriverName is closed. */
      default:
        return false;
    }
  }

  get configuredDrivers(): readonly TryOnDriverName[] {
    return TRYON_DRIVER_NAMES.filter((driver) => this.isDriverUsable(driver));
  }

  get isHttpDriverUsable(): boolean {
    return this.isDriverUsable(TryOnDriverName.HTTP);
  }

  get isGeminiDriver(): boolean {
    return this.driver === TryOnDriverName.GEMINI;
  }

  get geminiBaseUrl(): string | null {
    return this.geminiBaseUrlValue;
  }

  get geminiModel(): string | null {
    return this.geminiModelValue;
  }

  get isGeminiDriverUsable(): boolean {
    return this.isDriverUsable(TryOnDriverName.GEMINI);
  }

  get isOpenAiDriver(): boolean {
    return this.driver === TryOnDriverName.OPENAI;
  }

  get openAiBaseUrl(): string | null {
    return this.openAiBaseUrlValue;
  }

  get openAiModel(): string | null {
    return this.openAiModelValue;
  }

  get isOpenAiDriverUsable(): boolean {
    return this.isDriverUsable(TryOnDriverName.OPENAI);
  }

  private static readByteCap(raw: string | number | undefined): number {
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESPONSE_BYTES;
  }

  private static readTimeout(raw: string | number | undefined, fallback: number): number {
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  backoffMsFor(attempt: number): number {
    return this.backoffBaseMs * 2 ** Math.max(0, attempt - 1);
  }
}
