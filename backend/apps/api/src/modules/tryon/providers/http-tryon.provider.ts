import { Blob } from 'node:buffer';

import { Injectable, Logger } from '@nestjs/common';

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import sharp from 'sharp';

import { ErrorCode } from '@library/common';

import { TryOnDriverName } from '@api/config/env.validation';

import { TryOnConfig } from '../config/tryon.config';

import {
  TryOnProviderError,
  type TryOnGenerationRequest,
  type TryOnGenerationResult,
  type TryOnProvider,
  type TryOnProviderErrorCode,
} from './tryon-provider.interface';
import { runWithRetry } from './tryon-retry';

const GENERATE_PATH = '/generate';

const API_KEY_HEADER = 'X-API-KEY';

const GARMENT_FIELD = 'garment_image';
const PERSON_FIELD = 'person_image';

const MAX_ERROR_SNIPPET = 240;

const AXIOS_SIZE_ABORT = /max(content|body)length/i;

const REQUEST_IMAGES = 2;

const MULTIPART_FRAMING_SLACK_BYTES = 64 * 1024;

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

@Injectable()
export class HttpTryOnProvider implements TryOnProvider {
  readonly name = 'http' as const;

  private readonly logger = new Logger(HttpTryOnProvider.name);

  private readonly client: AxiosInstance;

  constructor(private readonly config: TryOnConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl ?? undefined,
      timeout: config.timeoutMs,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      maxRedirects: 0,
      maxContentLength: config.maxResponseBytes,
      maxBodyLength: config.maxResponseBytes * REQUEST_IMAGES + MULTIPART_FRAMING_SLACK_BYTES,
      decompress: false,
    });
  }

  async generate(request: TryOnGenerationRequest): Promise<TryOnGenerationResult> {
    if (!this.config.isHttpDriverUsable) {
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
          [API_KEY_HEADER]: this.config.readApiKey(TryOnDriverName.HTTP) ?? '',
          'X-Api-Version': this.config.apiVersion,
          'X-Correlation-Id': request.correlationId,
          'Accept-Encoding': 'identity',
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error: unknown) {
      throw this.classifyTransportError(error, attempt, request.correlationId);
    }

    return this.readResponse(response, request.correlationId);
  }

  private classifyTransportError(
    error: unknown,
    attempt: number,
    correlationId: string,
  ): TryOnProviderError {
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

    const timedOut =
      (axios.isAxiosError(error) &&
        (error.code === 'ECONNABORTED' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ERR_CANCELED')) ||
      (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'CanceledError'));

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

  private assertWithinCap(response: AxiosResponse<ArrayBuffer>, correlationId: string): void {
    const cap = this.config.maxResponseBytes;
    const declared = Number.parseInt(String(response.headers['content-length'] ?? ''), 10);
    const measured = response.data.byteLength;

    const declaredOverCap = Number.isInteger(declared) && declared > cap ? declared : null;
    if (declaredOverCap === null && measured <= cap) {
      return;
    }

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
