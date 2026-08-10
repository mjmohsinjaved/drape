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

/**
 * The upstream path. Versioned by `TRYONCLOUD_BASE_URL`, not by this constant — the
 * documented base is `https://www.tryoncloud.com/api/v1`, so this is `/generate` under it.
 */
const GENERATE_PATH = '/generate';

/**
 * The auth header TryOnCloud actually reads.
 *
 * It is `X-API-KEY`, not `Authorization: Bearer` — keys carry a `tk_dev_v1_` prefix and are
 * sent whole. This was written as a bearer token before the published contract was checked,
 * which would have failed every real call while the mock driver kept the suite green.
 */
const API_KEY_HEADER = 'X-API-KEY';

/** Multipart field names TryOnCloud expects. */
const GARMENT_FIELD = 'garment_image';
const PERSON_FIELD = 'person_image';

/** How much of an error body is worth keeping for a log line. Never the whole thing. */
const MAX_ERROR_SNIPPET = 240;

/**
 * axios's own words when it aborts a response for exceeding `maxContentLength` or
 * `maxBodyLength`. Matched so that a stream we cut off is classified as a malformed
 * response — which does **not** retry — rather than as a transient outage, which would
 * retry the bomb twice more.
 */
const AXIOS_SIZE_ABORT = /max(content|body)length/i;

/**
 * How much bigger the *request* bound is than the response bound.
 *
 * The two are not the same measurement and must not share a number. A response is one
 * render; a request is **two** images — the garment source and the person photo — and
 * both are stored as uploaded (only thumbnails are derived), so each can be as large as
 * `STORAGE_MAX_UPLOAD_MB` allowed. Bounding the request at the response cap would reject
 * a legitimate generation of two large pieces, which is a worse failure than the one
 * being prevented: the request bound is a backstop against a runaway body of our own
 * making, not a defence — both buffers are ours and both were size-checked on the way in.
 */
const REQUEST_IMAGES = 2;

/** Multipart boundaries, headers and filenames. Bytes, not megabytes. */
const MULTIPART_FRAMING_SLACK_BYTES = 64 * 1024;

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
 *  - **A bounded response.** `TRYON_MAX_RESPONSE_BYTES` caps what the process will hold
 *    for one upstream answer, and transparent decompression is off. Both matter because
 *    axios materialises the *whole* body into a Buffer before `readResponse` sees a
 *    status or a content type: a compromised upstream that answers a megabyte of gzip
 *    inflating to gigabytes would OOM the single API process — taking every live SSE
 *    result stream with it — long before any classification below could run.
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
      // Both default to `Infinity` on Node. Without `maxContentLength` axios buffers
      // the entire response before this class is given a chance to reject it.
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes * REQUEST_IMAGES + MULTIPART_FRAMING_SLACK_BYTES,
      // `decompress: true` (the default) makes the cap above a cap on the *inflated*
      // size only after the inflation has already happened in memory. The upstream
      // returns PNG, which is already compressed, so there is nothing to give up.
      decompress: false,
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
          [API_KEY_HEADER]: this.config.readApiKey() ?? '',
          'X-Api-Version': this.config.apiVersion,
          'X-Correlation-Id': request.correlationId,
          // axios advertises `gzip, deflate, br` whatever `decompress` says, so without
          // this a well-behaved upstream would gzip a body we have told axios not to
          // inflate and every render would arrive unreadable. Asking for `identity`
          // keeps the bytes on the wire the bytes we measure against the cap.
          'Accept-Encoding': 'identity',
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
    // axios cut the response off at `maxContentLength`. That is not an outage and must
    // not be retried — three attempts at a body designed to exhaust memory is the
    // vulnerability, not the mitigation — so it is classified as a malformed response.
    if (error instanceof Error && AXIOS_SIZE_ABORT.test(error.message)) {
      this.logger.warn(
        `Upstream response exceeded the ${this.config.maxResponseBytes}-byte cap on ` +
          `attempt ${attempt}. correlationId=${correlationId}`,
      );
      return new TryOnProviderError(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
        'The upstream response exceeded the permitted size.',
        undefined,
        { cause: error },
      );
    }

    // `ERR_CANCELED` / `CanceledError` belong here, and their absence was a live bug. Two
    // deadlines are armed per attempt: axios's own `timeout` (which surfaces as
    // `ECONNABORTED`) and the `AbortSignal.timeout` below it. They are set to the same
    // number, so which one fires first is a coin toss — and when the signal won, axios
    // wrapped it as `CanceledError`, none of the clauses matched, and a plain timeout was
    // reported as `UPSTREAM_UNAVAILABLE`. Both codes retry, so nothing behaved differently;
    // the operator was simply told the upstream was down when it was only slow, which is the
    // one distinction this log line exists to make.
    const timedOut =
      (axios.isAxiosError(error) &&
        (error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ERR_CANCELED')) ||
      (error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'CanceledError'));

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

    this.assertWithinCap(response, correlationId);

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
   * The size bound, re-asserted here rather than trusted to axios alone.
   *
   * `Content-Length` is checked first and on its own: it is a claim the upstream makes
   * *before* the body is worth looking at, and an answer that declares more than one
   * render's worth of bytes is refused whatever it then sends. The measured length is
   * then checked too, because `Content-Length` is optional under chunked transfer and a
   * hostile upstream will simply omit it.
   *
   * A failure here is `UPSTREAM_INVALID_RESPONSE`: §8.3 gives that code no retry, so an
   * oversized answer costs one attempt rather than `TRYON_MAX_ATTEMPTS` of them, and —
   * like every code in the taxonomy — it never reaches `commitGeneration()`, so the
   * consumer is charged neither quota nor budget for it.
   */
  private assertWithinCap(response: AxiosResponse<ArrayBuffer>, correlationId: string): void {
    const cap = this.config.maxResponseBytes;
    const declared = Number.parseInt(String(response.headers['content-length'] ?? ''), 10);
    const measured = response.data.byteLength;

    const declaredOverCap = Number.isInteger(declared) && declared > cap ? declared : null;
    if (declaredOverCap === null && measured <= cap) {
      return;
    }

    // The size, never a byte of the body (E-12).
    this.logger.warn(
      `Upstream response exceeded the ${cap}-byte cap ` +
        `(declared=${declaredOverCap ?? 'n/a'} measured=${measured}). ` +
        `correlationId=${correlationId}`,
    );

    throw new TryOnProviderError(
      ErrorCode.UPSTREAM_INVALID_RESPONSE,
      'The upstream response exceeded the permitted size.',
      response.status,
    );
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
