import { Blob } from 'node:buffer';

import { Injectable, Logger } from '@nestjs/common';

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import sharp from 'sharp';

import { ErrorCode } from '@library/common';

import { TryOnConfig } from '../config/tryon.config';

import {
  TryOnProviderError,
  type TryOnGenerationRequest,
  type TryOnGenerationResult,
  type TryOnProvider,
  type TryOnProviderErrorCode,
} from './tryon-provider.interface';
import { runWithRetry } from './tryon-retry';

/** The upstream path. Versioned by `TRYONCLOUD_BASE_URL`, not by this constant. */
const GENERATE_PATH = '/try-on';

/** Multipart field names TryOnCloud expects. */
const GARMENT_FIELD = 'garment_image';
const PERSON_FIELD = 'person_image';

/** How much of an error body is worth keeping for a log line. Never the whole thing. */
const MAX_ERROR_SNIPPET = 240;

/**
 * Upstream failure vocabulary → the §8.3 taxonomy.
 *
 * Matched as substrings against the upstream's `code`/`error`/`message`, lower-cased,
 * because a provider that renames `no_garment_detected` to `garment_not_detected` in a
 * point release must not silently become `UPSTREAM_INVALID_RESPONSE` — which would
 * stop flagging the garment for review (A-15) and start telling the consumer the wrong
 * thing.
 */
const BODY_CODE_PATTERNS: readonly (readonly [RegExp, TryOnProviderErrorCode])[] = [
  [
    /no[_ -]?garment|garment[_ -]?not[_ -]?(found|detected)|no[_ -]?clothing/,
    ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
  ],
  [/moderat|nsfw|explicit|inappropriate|policy[_ -]?violation/, ErrorCode.MODERATION_REJECTED],
  [
    /unsupported|corrupt|invalid[_ -]?image|bad[_ -]?format|decode/,
    ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
  ],
  [/rate[_ -]?limit|too[_ -]?many[_ -]?requests|quota/, ErrorCode.UPSTREAM_RATE_LIMITED],
  [
    /unauthori[sz]ed|forbidden|invalid[_ -]?(api[_ -]?)?key|authentication/,
    ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
  ],
];

/**
 * The real TryOnCloud client — PRD §8.1 step 5, §8.3, E-11.
 *
 * **Never selected in local or CI.** The upstream account has a ten-image budget; the
 * factory picks `MockTryOnProvider` unless `TRYON_DRIVER=http`, and the test
 * environment pins the mock. This class exists so that flipping one environment
 * variable in production is the whole change.
 *
 * ### What it guarantees (E-11)
 *
 *  - **A timeout on every call.** `TRYON_TIMEOUT_MS`, per attempt, enforced by axios
 *    and re-enforced by an abort signal so a stalled socket cannot outlive it.
 *  - **Bounded retry with exponential backoff.** `TRYON_MAX_ATTEMPTS` total attempts
 *    (3 per §8.3), only for the retryable codes, through the same `runWithRetry` the
 *    mock uses — so the retry semantics under test are the retry semantics in
 *    production.
 *  - **Typed errors only.** Every axios shape, every unexpected content type and every
 *    malformed body is classified into the §8.3 taxonomy before it leaves this class.
 *
 * ### What it never does (E-12, B-1, §9.2)
 *
 * It never logs an image, a fragment of an image, a storage key, or the API key. Log
 * lines carry the correlation id, the attempt number, the HTTP status and the mapped
 * error code — nothing that identifies a person or could be replayed. The key is read
 * through `TryOnConfig.readApiKey()` at call time and put straight into a header;
 * `redact.util` would catch it in a structured log, but the code never gives it the
 * chance.
 */
@Injectable()
export class HttpTryOnProvider implements TryOnProvider {
  readonly name = 'http' as const;

  private readonly logger = new Logger(HttpTryOnProvider.name);

  private readonly client: AxiosInstance;

  constructor(private readonly config: TryOnConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl ?? undefined,
      timeout: config.timeoutMs,
      // Classify from the status ourselves — throwing inside axios loses the body,
      // and the body is where `no_garment_detected` lives.
      validateStatus: () => true,
      responseType: 'arraybuffer',
      maxRedirects: 0,
    });
  }

  async generate(request: TryOnGenerationRequest): Promise<TryOnGenerationResult> {
    if (!this.config.isHttpDriverUsable) {
      // Startup validation catches this first (`validateEnv` makes the key required
      // when the driver is `http`); this is the runtime backstop §2.4 asks for.
      throw new TryOnProviderError(
        ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
        'TRYON_DRIVER=http with no base URL or API key.',
      );
    }

    const startedAt = Date.now();

    const outcome = await runWithRetry(
      async (attempt: number): Promise<Buffer> => this.attempt(request, attempt),
      {
        maxAttempts: this.config.maxAttempts,
        backoffMsFor: (attempt) => this.config.backoffMsFor(attempt),
        onRetry: (attempt, error, waitMs): void => {
          this.logger.warn(
            `Upstream attempt ${attempt} failed (${error.errorCode}` +
              `${error.status === undefined ? '' : `, status ${error.status}`}); ` +
              `retrying in ${waitMs}ms. correlationId=${request.correlationId}`,
          );
        },
      },
    );

    const metadata = await this.measure(outcome.value);

    return {
      png: outcome.value,
      width: metadata.width,
      height: metadata.height,
      durationMs: Date.now() - startedAt,
      attempts: outcome.attempts,
    };
  }

  /** One upstream call. Throws a typed `TryOnProviderError`, never an axios error. */
  private async attempt(request: TryOnGenerationRequest, attempt: number): Promise<Buffer> {
    const form = new FormData();
    form.append(
      GARMENT_FIELD,
      new Blob([new Uint8Array(request.garmentImage)], { type: request.garmentImageMimeType }),
      'garment',
    );
    form.append(
      PERSON_FIELD,
      new Blob([new Uint8Array(request.personImage)], { type: request.personImageMimeType }),
      'person',
    );

    let response: AxiosResponse<ArrayBuffer>;
    try {
      response = await this.client.post<ArrayBuffer>(GENERATE_PATH, form, {
        headers: {
          Authorization: `Bearer ${this.config.readApiKey() ?? ''}`,
          'X-Api-Version': this.config.apiVersion,
          'X-Correlation-Id': request.correlationId,
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error: unknown) {
      throw this.classifyTransportError(error, attempt, request.correlationId);
    }

    return this.readResponse(response, request.correlationId);
  }

  /**
   * A transport failure — no HTTP response was received.
   *
   * A timeout and a refused connection are different consumer stories only in that
   * both are retryable; §8.3 gives them the same copy ("Taking longer than usual"),
   * which is why the two codes share a message in `ERROR_CODE_SPECS`.
   */
  private classifyTransportError(
    error: unknown,
    attempt: number,
    correlationId: string,
  ): TryOnProviderError {
    const timedOut =
      (axios.isAxiosError(error) &&
        (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) ||
      (error instanceof Error && error.name === 'TimeoutError');

    const code = timedOut ? ErrorCode.UPSTREAM_TIMEOUT : ErrorCode.UPSTREAM_UNAVAILABLE;

    this.logger.warn(
      `Upstream transport failure on attempt ${attempt}: ${code}. correlationId=${correlationId}`,
    );

    return new TryOnProviderError(
      code,
      timedOut ? 'The upstream call timed out.' : 'The upstream was unreachable.',
      undefined,
      { cause: error },
    );
  }

  /** Turns a received response into PNG bytes, or into the §8.3 code it represents. */
  private readResponse(response: AxiosResponse<ArrayBuffer>, correlationId: string): Buffer {
    const status = response.status;
    const body = Buffer.from(response.data);
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();

    if (status >= 200 && status < 300 && contentType.includes('image/')) {
      if (body.length === 0) {
        throw new TryOnProviderError(
          ErrorCode.UPSTREAM_INVALID_RESPONSE,
          'The upstream returned an empty image.',
          status,
        );
      }
      return body;
    }

    const snippet = this.snippetOf(body, contentType);
    const fromBody = this.classifyBody(snippet);
    const code = fromBody ?? this.classifyStatus(status);

    this.logger.warn(
      `Upstream rejected the generation: status=${status} code=${code} ` +
        `correlationId=${correlationId}`,
    );

    throw new TryOnProviderError(code, `Upstream responded ${status} (${code}).`, status);
  }

  /**
   * A short, text-only excerpt of an error body.
   *
   * Bounded because an upstream that echoes the request back would otherwise put an
   * image into a log line, and skipped entirely for a binary content type for the same
   * reason (E-12).
   */
  private snippetOf(body: Buffer, contentType: string): string {
    if (contentType.includes('image/') || contentType.includes('octet-stream')) {
      return '';
    }
    return body.toString('utf8', 0, MAX_ERROR_SNIPPET).toLowerCase();
  }

  private classifyBody(snippet: string): TryOnProviderErrorCode | null {
    if (snippet.length === 0) {
      return null;
    }
    for (const [pattern, code] of BODY_CODE_PATTERNS) {
      if (pattern.test(snippet)) {
        return code;
      }
    }
    return null;
  }

  private classifyStatus(status: number): TryOnProviderErrorCode {
    if (status === 401 || status === 403) {
      return ErrorCode.TRYON_PROVIDER_MISCONFIGURED;
    }
    if (status === 408) {
      return ErrorCode.UPSTREAM_TIMEOUT;
    }
    if (status === 429) {
      return ErrorCode.UPSTREAM_RATE_LIMITED;
    }
    if (status >= 500) {
      return ErrorCode.UPSTREAM_UNAVAILABLE;
    }
    if (status === 415 || status === 422) {
      return ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT;
    }
    return ErrorCode.UPSTREAM_INVALID_RESPONSE;
  }

  /** Dimensions of the returned render. An unreadable PNG is a malformed response. */
  private async measure(png: Buffer): Promise<{ width: number; height: number }> {
    try {
      const metadata = await sharp(png).metadata();
      if (metadata.width === undefined || metadata.height === undefined) {
        throw new Error('no dimensions');
      }
      return { width: metadata.width, height: metadata.height };
    } catch (error: unknown) {
      throw new TryOnProviderError(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
        'The upstream returned bytes that are not a readable image.',
        undefined,
        { cause: error },
      );
    }
  }
}
