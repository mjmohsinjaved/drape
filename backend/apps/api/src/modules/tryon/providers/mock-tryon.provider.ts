import { Injectable, Logger } from '@nestjs/common';

import sharp from 'sharp';

import { ErrorCode, sha256Hex } from '@library/common';

import { TryOnConfig } from '../config/tryon.config';

import {
  TRYON_PROVIDER_ERROR_CODES,
  TryOnProviderError,
  type TryOnGenerationRequest,
  type TryOnGenerationResult,
  type TryOnProvider,
  type TryOnProviderErrorCode,
} from './tryon-provider.interface';
import { runWithRetry } from './tryon-retry';

/** The render the mock produces. Portrait, the shape a real try-on comes back in. */
export const MOCK_RENDER_WIDTH = 768;
export const MOCK_RENDER_HEIGHT = 1152;

/**
 * The default try-on provider — `TRYON_DRIVER=mock`.
 *
 * ### Why this is the default and not a convenience
 *
 * The TryOnCloud account holds a total budget of **ten images**, permanently. A single
 * careless test run against the http driver would spend a meaningful fraction of the
 * project's entire upstream allowance. So `mock` is the default in `.env.example`, it
 * is pinned in `test-env.ts`, and `tryon-provider.factory.spec.ts` asserts that the
 * test environment resolves to this class. Nothing in local development or CI can
 * reach the network through the try-on path.
 *
 * ### Deterministic
 *
 * The same two images always produce the same bytes. The render's colour is derived
 * from `sha256(garmentImage) + sha256(personImage)`, so a cache test can assert "the
 * same bytes came back" honestly, and a cache-key test can change the photo and watch
 * both the key **and** the pixels change (C-16).
 *
 * ### Honest about latency (C-19)
 *
 * `TRYON_MOCK_LATENCY_MS` defaults to 7000 — the real upstream's typical response —
 * so the staged microcopy, the SSE `stage` events and the results tray are exercised
 * against a wait that actually exists. The test environment pins it to 0.
 *
 * ### Every failure mode, on demand (E-6)
 *
 * Two ways to fail, because E-6 needs both:
 *
 *  - **explicitly** — `failNext(code)` / `alwaysFail(code)`. One integration test per
 *    row of the §8.3 table, with no probabilistic flakiness whatsoever;
 *  - **statistically** — `TRYON_MOCK_FAILURE_RATE` between 0 and 1. Deterministic per
 *    request (derived from the same hash, not from `Math.random()`), so a run that
 *    fails is a run that fails again.
 *
 * Retry and backoff run here exactly as they do in the http provider, through the same
 * `runWithRetry`, so a queued `UPSTREAM_RATE_LIMITED` followed by a success reports
 * `attempts: 2` and proves the §8.3 "silent, stays pending" branch end to end.
 */
@Injectable()
export class MockTryOnProvider implements TryOnProvider {
  readonly name = 'mock' as const;

  private readonly logger = new Logger(MockTryOnProvider.name);

  /** Failures to serve, one per attempt, oldest first. Drained as they are used. */
  private readonly queuedFailures: TryOnProviderErrorCode[] = [];

  /** When set, every attempt fails with this code until it is cleared. */
  private stickyFailure: TryOnProviderErrorCode | null = null;

  constructor(private readonly config: TryOnConfig) {}

  /**
   * Fail the next `times` attempts with `code`, then behave normally.
   *
   * ```ts
   * provider.failNext(ErrorCode.UPSTREAM_TIMEOUT, 2); // two timeouts, then a render
   * ```
   */
  failNext(code: TryOnProviderErrorCode, times = 1): void {
    for (let index = 0; index < Math.max(1, times); index += 1) {
      this.queuedFailures.push(code);
    }
  }

  /** Fail every attempt with `code` until {@link reset} is called. */
  alwaysFail(code: TryOnProviderErrorCode): void {
    this.stickyFailure = code;
  }

  /** Clears both the queue and the sticky failure. */
  reset(): void {
    this.queuedFailures.length = 0;
    this.stickyFailure = null;
  }

  async generate(request: TryOnGenerationRequest): Promise<TryOnGenerationResult> {
    const startedAt = Date.now();
    const seed = this.seedOf(request);

    const outcome = await runWithRetry(
      async (): Promise<Buffer> => {
        await this.simulateLatency();
        const failure = this.nextFailure(seed);
        if (failure !== null) {
          throw new TryOnProviderError(failure, `Mock provider simulated ${failure}.`);
        }
        return this.renderFor(seed);
      },
      {
        maxAttempts: this.config.maxAttempts,
        backoffMsFor: (attempt) => this.config.backoffMsFor(attempt),
        onRetry: (attempt, error, waitMs): void => {
          this.logger.debug(
            `Mock attempt ${attempt} failed with ${error.errorCode}; retrying in ${waitMs}ms.`,
          );
        },
      },
    );

    return {
      png: outcome.value,
      width: MOCK_RENDER_WIDTH,
      height: MOCK_RENDER_HEIGHT,
      durationMs: Date.now() - startedAt,
      attempts: outcome.attempts,
    };
  }

  /**
   * A stable 64-hex seed for this pair of images.
   *
   * Note what is *not* in it: no user id, no photo id, no storage key. The provider
   * never sees them and could not leak them into a log if it wanted to (E-12).
   */
  private seedOf(request: TryOnGenerationRequest): string {
    return sha256Hex(
      `${sha256Hex(request.garmentImage)}:${sha256Hex(request.personImage)}:${this.config.apiVersion}`,
    );
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.mockLatencyMs;
    if (latency <= 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, latency);
    });
  }

  /**
   * The failure this attempt should serve, or `null` for a render.
   *
   * Explicit instructions win over the configured rate: a test that asked for a
   * timeout gets a timeout regardless of what `TRYON_MOCK_FAILURE_RATE` happens to be.
   */
  private nextFailure(seed: string): TryOnProviderErrorCode | null {
    if (this.stickyFailure !== null) {
      return this.stickyFailure;
    }
    const queued = this.queuedFailures.shift();
    if (queued !== undefined) {
      return queued;
    }
    return this.sampledFailure(seed);
  }

  /**
   * Derived from the seed rather than from `Math.random()`, so "the failure rate is
   * 0.5" means *these* requests fail and they fail again on the next run.
   */
  private sampledFailure(seed: string): TryOnProviderErrorCode | null {
    const rate = this.config.mockFailureRate;
    if (rate <= 0) {
      return null;
    }
    const bucket = Number.parseInt(seed.slice(0, 8), 16) / 0xffffffff;
    if (bucket >= rate) {
      return null;
    }
    const index = Number.parseInt(seed.slice(8, 12), 16) % TRYON_PROVIDER_ERROR_CODES.length;
    return TRYON_PROVIDER_ERROR_CODES[index] ?? ErrorCode.UPSTREAM_UNAVAILABLE;
  }

  /** A real PNG — `sharp` has to be able to read it, because `ImageService` will. */
  private async renderFor(seed: string): Promise<Buffer> {
    return sharp({
      create: {
        width: MOCK_RENDER_WIDTH,
        height: MOCK_RENDER_HEIGHT,
        channels: 3,
        background: {
          r: Number.parseInt(seed.slice(0, 2), 16),
          g: Number.parseInt(seed.slice(2, 4), 16),
          b: Number.parseInt(seed.slice(4, 6), 16),
        },
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
}
