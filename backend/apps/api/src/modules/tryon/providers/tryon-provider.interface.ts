import { ErrorCode } from '@library/common';

/** DI token for the selected {@link TryOnProvider}. Bound once, by the factory. */
export const TRYON_PROVIDER = Symbol('TRYON_PROVIDER');

/**
 * One generation request.
 *
 * Both images are **bytes**, never keys and never URLs. The provider has no storage
 * dependency and cannot be handed something it would have to resolve, which is what
 * keeps `HttpTryOnProvider` from ever putting a `person-photos/**` key on the wire or
 * in a log line (E-12).
 */
export interface TryOnGenerationRequest {
  /** The garment try-on source image (`garment_images.isTryOnSource`). */
  readonly garmentImage: Buffer;
  readonly garmentImageMimeType: string;
  /** The person image: a consumer photo, or a `reference_models` photo for A-11. */
  readonly personImage: Buffer;
  readonly personImageMimeType: string;
  /**
   * Correlation only. A job id, never a user id, an email or a storage key — it ends
   * up in a log line and in the upstream's request metadata.
   */
  readonly correlationId: string;
}

/** A successful generation. Always PNG — that is what the upstream returns. */
export interface TryOnGenerationResult {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  /** How long the successful attempt took, for `tryon.upstream_latency_ms` (E-13). */
  readonly durationMs: number;
  /** 1-based attempt that succeeded. `> 1` means a retry rescued it (§8.3). */
  readonly attempts: number;
}

/**
 * The upstream seam — PRD §8.1 step 5, §8.3, E-11.
 *
 * Two implementations exist and exactly one is bound at runtime by
 * `createTryOnProvider()`:
 *
 *  - `MockTryOnProvider` — the **default** (`TRYON_DRIVER=mock`). Deterministic,
 *    configurable latency, every failure mode reachable on demand.
 *  - `HttpTryOnProvider` — real TryOnCloud over axios.
 *
 * The upstream account holds a total budget of **ten images**, so local and CI must
 * never reach the http driver. `tryon-provider.factory.spec.ts` asserts that the test
 * environment selects the mock, and `TryOnService` never constructs a provider itself.
 *
 * ### The contract
 *
 * `generate()` either resolves with a PNG or rejects with a `TryOnProviderError`
 * carrying an `ErrorCode` from the §8.3 taxonomy. It **never** rejects with anything
 * else: an axios error, a parse failure and a socket hang-up are all classified before
 * they leave the implementation, because the caller's job is to write a `tryon_jobs`
 * row and a consumer message, not to interpret a transport library's error shape.
 *
 * Retry and backoff live **inside** the provider, so `attempts` is already the final
 * count when the promise settles and `TryOnService` never has to re-enter a spend path.
 */
export interface TryOnProvider {
  /** `mock` or `http` — used as the `driver` metric tag and asserted by tests. */
  readonly name: 'mock' | 'http';

  generate(request: TryOnGenerationRequest): Promise<TryOnGenerationResult>;
}

/** The §8.3 conditions a provider is allowed to fail with. */
export type TryOnProviderErrorCode =
  | ErrorCode.UPSTREAM_NO_GARMENT_DETECTED
  | ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT
  | ErrorCode.MODERATION_REJECTED
  | ErrorCode.UPSTREAM_TIMEOUT
  | ErrorCode.UPSTREAM_UNAVAILABLE
  | ErrorCode.UPSTREAM_RATE_LIMITED
  | ErrorCode.UPSTREAM_INVALID_RESPONSE
  | ErrorCode.TRYON_PROVIDER_MISCONFIGURED;

/** Every code a provider may raise, for the E-6 sweep over the taxonomy. */
export const TRYON_PROVIDER_ERROR_CODES: readonly TryOnProviderErrorCode[] = [
  ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
  ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
  ErrorCode.MODERATION_REJECTED,
  ErrorCode.UPSTREAM_TIMEOUT,
  ErrorCode.UPSTREAM_UNAVAILABLE,
  ErrorCode.UPSTREAM_RATE_LIMITED,
  ErrorCode.UPSTREAM_INVALID_RESPONSE,
  ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
];

/**
 * A typed upstream failure.
 *
 * Not an `AppException`: this is the provider's vocabulary, and `TryOnService` decides
 * what a consumer sees after consulting the §8.3 policy table (a rate-limited attempt
 * that later succeeds is never surfaced at all). Turning it into an HTTP status here
 * would make that decision in the wrong place.
 *
 * `message` is for the log. **It never reaches a consumer** — the consumer-facing copy
 * comes from `ERROR_CODE_SPECS`, verbatim from PRD §8.3.
 */
export class TryOnProviderError extends Error {
  constructor(
    readonly errorCode: TryOnProviderErrorCode,
    message: string,
    /** Upstream HTTP status, when there was one. */
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TryOnProviderError';
  }
}

/** true when `value` is a typed provider failure rather than an unclassified throw. */
export function isTryOnProviderError(value: unknown): value is TryOnProviderError {
  return value instanceof TryOnProviderError;
}
