import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TryOnDriverName } from '@api/config/env.validation';

/**
 * Default ceiling on an upstream response body — 25 MB, the same order as
 * `STORAGE_MAX_UPLOAD_MB`. Overridden by `TRYON_MAX_RESPONSE_BYTES`.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

/**
 * The try-on module's slice of §7, resolved once at construction.
 *
 * **`apiKey` exists here and nowhere else** (PRD B-1, §9.2). It is `null` under the
 * mock driver, it is never logged, never serialised into a DTO and never put on an
 * error. `HttpTryOnProvider` is the only class that reads it, and it reads it through
 * this object rather than from `process.env`, so there is exactly one place to audit.
 *
 * Every value comes from `ConfigService`, which `validateEnv()` has already checked
 * (`TRYONCLOUD_API_KEY` is *required* when `TRYON_DRIVER=http`). Nothing here carries
 * a secret default — a missing key fails the boot, not the request (PRD E-2).
 */
@Injectable()
export class TryOnConfig {
  /** `mock` in local and CI. The upstream account has a **10-image** total budget. */
  readonly driver: TryOnDriverName;

  /** Third component of the §3.7 cache key. Bumping it invalidates the whole cache. */
  readonly apiVersion: string;

  /** Per-attempt upstream timeout (E-11). */
  readonly timeoutMs: number;

  /** Retry ceiling, **3** per §8.3 — total attempts, not retries-after-the-first. */
  readonly maxAttempts: number;

  /**
   * Hard ceiling on an upstream response body, in bytes (E-11).
   *
   * The upstream returns one render. Without a ceiling, axios buffers whatever arrives
   * into a single `Buffer` *before* the provider can look at the status or the content
   * type — so a hostile or compromised upstream can spend a megabyte of gzip to make
   * the API allocate gigabytes, three times over per `TRYON_MAX_ATTEMPTS`, and take the
   * single process down along with every open SSE stream.
   *
   * 25 MB by default, matching `STORAGE_MAX_UPLOAD_MB`: a render is a PNG of roughly
   * the same order as the photo that produced it, and a body larger than the largest
   * thing we would ever accept as an upload is not a render.
   */
  readonly maxResponseBytes: number;

  /** Exponential backoff base: attempt *n* waits `base * 2^(n-1)`. */
  readonly backoffBaseMs: number;

  /** §8.2 — bulk test renders never compete with a live consumer generation. */
  readonly testRenderConcurrency: number;

  /** Mock latency, so the C-19 seven-second wait is exercised honestly. */
  readonly mockLatencyMs: number;

  /** `0`–`1`. E-6 walks the failure taxonomy with this. */
  readonly mockFailureRate: number;

  /** C-6 — per-account generations per rolling hour, above the monthly quota. */
  readonly ratePerHour: number;

  /** C-6 — per-IP generations per rolling hour. */
  readonly ratePerIpHour: number;

  private readonly baseUrlValue: string | null;

  /** Never exposed as a property, so it cannot be spread into a log or a DTO. */
  private readonly apiKeyValue: string | null;

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

    this.baseUrlValue = config.get<string>('TRYONCLOUD_BASE_URL') ?? null;
    this.apiKeyValue = config.get<string>('TRYONCLOUD_API_KEY') ?? null;
  }

  /** true when the real upstream is selected. Every spend-guard test asserts this is false. */
  get isHttpDriver(): boolean {
    return this.driver === TryOnDriverName.HTTP;
  }

  /** `null` when unset. The factory turns that into `TRYON_PROVIDER_MISCONFIGURED`. */
  get baseUrl(): string | null {
    return this.baseUrlValue;
  }

  /**
   * The upstream credential.
   *
   * Deliberately a method rather than a field: `{ ...config }` in a log line, a DTO
   * or a test snapshot cannot pick it up, and every read is greppable.
   */
  readApiKey(): string | null {
    return this.apiKeyValue;
  }

  /** true when the http driver has everything it needs to make a call. */
  get isHttpDriverUsable(): boolean {
    return (
      this.baseUrlValue !== null &&
      this.baseUrlValue.length > 0 &&
      this.apiKeyValue !== null &&
      this.apiKeyValue.length > 0
    );
  }

  /**
   * `TRYON_MAX_RESPONSE_BYTES` → a positive integer, or `DEFAULT_MAX_RESPONSE_BYTES`.
   *
   * Read defensively rather than with `getOrThrow` because `env.validation.ts` does not
   * yet declare the key, so `ConfigService` hands back the raw string when it is set and
   * `undefined` when it is not. This is a *bound*, never a secret — E-2 forbids a default
   * for a credential, not for a ceiling — and a bound that fails open would be the whole
   * vulnerability back again, so an unparseable value falls back to the default rather
   * than to "unlimited".
   */
  private static readByteCap(raw: string | number | undefined): number {
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESPONSE_BYTES;
  }

  /** Backoff for attempt `attempt` (1-based), in milliseconds. */
  backoffMsFor(attempt: number): number {
    return this.backoffBaseMs * 2 ** Math.max(0, attempt - 1);
  }
}
