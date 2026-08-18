import { Blob } from 'node:buffer';

import { Injectable, Logger } from '@nestjs/common';

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import sharp from 'sharp';

import { ErrorCode } from '@library/common';

import { OpenAiImageQuality, TryOnDriverName } from '@api/config/env.validation';

import { TryOnConfig } from '../config/tryon.config';

import {
  TryOnProviderError,
  type TryOnGenerationRequest,
  type TryOnGenerationResult,
  type TryOnProvider,
  type TryOnProviderErrorCode,
} from './tryon-provider.interface';
import { runWithRetry } from './tryon-retry';

const EDITS_PATH = '/images/edits';

const AUTH_HEADER = 'Authorization';

const IMAGE_FIELD = 'image[]';

const PROMPT = [
  'A person in the first image and garment shown in the second image.',
  'TASK: Replace the person entire existing outfit in the first image with the exact outfit shown in second image.',
  'PRESERVE FROM THE FIRST IMAGE (do not change): the person face, facial features, expression, skin tone, makeup, hairstyle, body shape, proportions, pose, hand positions, and the background style.',
  'PRODUCT ACCURACY: reproduce the outfit from second image exactly — same colors, fabric, texture, prints, embroidery, embellishments, buttons, borders, and silhouette. Include every piece that is part of the product (top, bottom, jacket, dupatta, stole, drape, or headwear), styled the same way as on the product model. Fully remove all of the person original clothing, including any existing drapes or layers. Do not redesign, recolor, simplify, or omit any detail.',
  'GARMENT COVERAGE: the outfit must cover the person body exactly as it covers the product model in second image — never as their original clothing did. Sleeves extend to the same endpoint as in second image on BOTH arms equally, regardless of arm position (raised, bent, or crossed): if the product has full-length sleeves, both sleeves reach the wrists with their cuffs and borders intact. The neckline, hemline, and all layers follow second image cut. Any skin that is covered on the product model must be covered on the person; ignore where the original outfit sleeves or hems ended.',
  'FIT & PLACEMENT: the outfit fits the person body naturally in their current pose, with the same length, silhouette, and draping as shown in second image — the fabric folds realistically around the person posture without warping or smearing patterns or embroidery.',
  'ACCESSORIES: keep the person own jewelry and accessories from the first image unchanged, except where a product piece from second image covers that area. Do not copy the product model jewelry, makeup, hairstyle, face, or body. FRAMING: if any part of the outfit extends beyond the first image visible area (e.g., a full-length garment in a cropped photo), extend the image naturally to show the complete outfit head to toe, continuing the existing background and adding a plausible floor consistent with the first image lighting. Otherwise, keep the original framing.',
  'INTEGRATION: match the first image lighting direction, color temperature, shadows, and perspective so the outfit looks physically worn with correct scale — not pasted or floating. OUTPUT: photorealistic, high resolution, sharp focus, portrait orientation showing the complete outfit.',
  'DO NOT: alter the face or hands, change the person identity, shorten sleeves, raise hemlines, leave any garment piece partially applied or any arm uncovered where the product covers it, add text, watermarks, borders, collage panels, or extra people, or change the background style.',
].join(' ');

const IMAGE_SIZE = '1024x1536';

const MODERATION = 'low';

const IMAGE_COUNT = '1';

const MAX_ERROR_SNIPPET = 240;

const AXIOS_SIZE_ABORT = /max(content|body)length/i;

const REQUEST_IMAGES = 2;

const JSON_FRAMING_SLACK_BYTES = 64 * 1024;

function transportBoundFor(imageBytes: number): number {
  return Math.ceil((imageBytes * 4) / 3) + JSON_FRAMING_SLACK_BYTES;
}

const BODY_CODE_PATTERNS: readonly (readonly [RegExp, TryOnProviderErrorCode])[] = [
  [
    /insufficient[_ -]?quota|credit[_ -]?balance[_ -]?exhausted|no credits remaining|billing[_ -]?hard[_ -]?limit|exceeded your current quota|check your plan and billing|add credits/,
    ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
  ],
  [
    /organi[sz]ation must be verified|verify organization|organi[sz]ation[_ -]?verification|must be verified to use the model/,
    ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
  ],
  [
    /moderation[_ -]?blocked|safety[_ -]?system|content[_ -]?policy|policy[_ -]?violation|flagged|rejected as a result of our safety/,
    ErrorCode.MODERATION_REJECTED,
  ],
  [
    /invalid[_ -]?api[_ -]?key|incorrect api key|unauthori[sz]ed|permission[_ -]?denied|account[_ -]?deactivated|model[_ -]?not[_ -]?found|does not exist or you do not have access/,
    ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
  ],
  [
    /rate[_ -]?limit|too[_ -]?many[_ -]?requests|slow[_ -]?down|requests per min/,
    ErrorCode.UPSTREAM_RATE_LIMITED,
  ],
  [
    /no (person|garment|clothing) (is )?(visible|present|detected)|cannot (see|identify) (a|the) (garment|person)|no[_ -]?garment/,
    ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
  ],
  [
    /unsupported[_ -]?(image|mime|format)|invalid[_ -]?image|corrupt|could not (be )?process|decode|image[_ -]?parse/,
    ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
  ],
  [/timeout|timed out|deadline/, ErrorCode.UPSTREAM_TIMEOUT],
  [
    /server[_ -]?error|internal[_ -]?error|overloaded|engine is currently overloaded|try again later|service[_ -]?unavailable/,
    ErrorCode.UPSTREAM_UNAVAILABLE,
  ],
];

interface OpenAiImageDatum {
  readonly b64_json?: string;
  readonly url?: string;
  readonly revised_prompt?: string;
}

interface OpenAiErrorBody {
  readonly message?: string;
  readonly type?: string;
  readonly code?: string;
  readonly param?: string;
}

interface OpenAiResponseBody {
  readonly data?: readonly OpenAiImageDatum[];
  readonly error?: OpenAiErrorBody;
  readonly refusal?: string;
}

@Injectable()
export class OpenAiTryOnProvider implements TryOnProvider {
  readonly name = 'openai' as const;

  private readonly logger = new Logger(OpenAiTryOnProvider.name);

  private readonly client: AxiosInstance;

  constructor(
    private readonly config: TryOnConfig,
    private readonly readQuality: () => Promise<OpenAiImageQuality>,
  ) {
    const timeoutMs = config.timeoutMsFor(TryOnDriverName.OPENAI);

    this.client = axios.create({
      baseURL: config.openAiBaseUrl ?? undefined,
      timeout: timeoutMs,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      maxRedirects: 0,
      maxContentLength: transportBoundFor(config.maxResponseBytes),
      maxBodyLength: config.maxResponseBytes * REQUEST_IMAGES + JSON_FRAMING_SLACK_BYTES,
      decompress: false,
    });
  }

  async generate(request: TryOnGenerationRequest): Promise<TryOnGenerationResult> {
    if (!this.config.isOpenAiDriverUsable) {
      throw new TryOnProviderError(
        ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
        'The OpenAI driver is selected with no base URL, model or API key.',
      );
    }

    const startedAt = Date.now();
    const quality = await this.readQuality();

    const outcome = await runWithRetry(
      async (attempt: number): Promise<Buffer> => this.attempt(request, quality, attempt),
      {
        maxAttempts: this.config.maxAttempts,
        backoffMsFor: (attempt) => this.config.backoffMsFor(attempt),
        onRetry: (attempt, error, waitMs): void => {
          this.logger.warn(
            `OpenAI attempt ${attempt} failed (${error.errorCode}` +
              `${error.status === undefined ? '' : `, status ${error.status}`}); ` +
              `retrying in ${waitMs}ms. correlationId=${request.correlationId}`,
          );
        },
      },
    );

    const png = await this.toPng(outcome.value);
    const metadata = await this.measure(png);

    return {
      png,
      width: metadata.width,
      height: metadata.height,
      durationMs: Date.now() - startedAt,
      attempts: outcome.attempts,
    };
  }

  private async attempt(
    request: TryOnGenerationRequest,
    quality: OpenAiImageQuality,
    attempt: number,
  ): Promise<Buffer> {
    const form = new FormData();
    form.append('model', this.config.openAiModel ?? '');
    form.append('prompt', PROMPT);
    form.append('n', IMAGE_COUNT);
    form.append('size', IMAGE_SIZE);
    form.append('quality', quality);
    form.append('moderation', MODERATION);
    form.append('output_format', 'png');

    form.append(
      IMAGE_FIELD,
      new Blob([new Uint8Array(request.personImage)], { type: request.personImageMimeType }),
      'person.png',
    );
    form.append(
      IMAGE_FIELD,
      new Blob([new Uint8Array(request.garmentImage)], { type: request.garmentImageMimeType }),
      'garment.png',
    );

    let response: AxiosResponse<ArrayBuffer>;
    try {
      response = await this.client.post<ArrayBuffer>(EDITS_PATH, form, {
        headers: {
          [AUTH_HEADER]: `Bearer ${this.config.readApiKey(TryOnDriverName.OPENAI) ?? ''}`,
          'X-Correlation-Id': request.correlationId,
          'Accept-Encoding': 'identity',
        },
        signal: AbortSignal.timeout(this.config.timeoutMsFor(TryOnDriverName.OPENAI)),
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
        `OpenAI response exceeded the transport cap on attempt ${attempt}. ` +
          `correlationId=${correlationId}`,
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
      `OpenAI transport failure on attempt ${attempt}: ${code}. correlationId=${correlationId}`,
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

    const parsed = this.parseBody(Buffer.from(response.data), status);

    if (status < 200 || status >= 300) {
      throw this.rejection(status, this.classifyError(parsed, status), correlationId);
    }

    const refusal = parsed.refusal;
    if (refusal !== undefined && refusal.length > 0) {
      const code = this.classifyText(refusal) ?? ErrorCode.MODERATION_REJECTED;
      this.logger.warn(`OpenAI refused the edit: code=${code} correlationId=${correlationId}`);
      throw new TryOnProviderError(code, `OpenAI refused the edit (${code}).`, status);
    }

    const datum = parsed.data?.[0];

    if (datum?.b64_json === undefined && datum?.url !== undefined) {
      throw new TryOnProviderError(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
        'The upstream returned a URL rather than image bytes.',
        status,
      );
    }

    const encoded = datum?.b64_json;
    if (encoded === undefined || encoded.length === 0) {
      const code =
        this.classifyText(datum?.revised_prompt ?? '') ?? ErrorCode.UPSTREAM_INVALID_RESPONSE;
      this.logger.warn(
        `OpenAI returned no image: status=${status} code=${code} correlationId=${correlationId}`,
      );
      throw new TryOnProviderError(
        code,
        `OpenAI answered ${status} without an image (${code}).`,
        status,
      );
    }

    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length === 0) {
      throw new TryOnProviderError(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
        'The upstream returned an empty image.',
        status,
      );
    }
    if (bytes.length > this.config.maxResponseBytes) {
      this.logger.warn(
        `OpenAI render exceeded the ${this.config.maxResponseBytes}-byte cap ` +
          `(decoded=${bytes.length}). correlationId=${correlationId}`,
      );
      throw new TryOnProviderError(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
        'The upstream response exceeded the permitted size.',
        status,
      );
    }

    return bytes;
  }

  private assertWithinCap(response: AxiosResponse<ArrayBuffer>, correlationId: string): void {
    const cap = transportBoundFor(this.config.maxResponseBytes);
    const declared = Number.parseInt(String(response.headers['content-length'] ?? ''), 10);
    const measured = response.data.byteLength;

    const declaredOverCap = Number.isInteger(declared) && declared > cap ? declared : null;
    if (declaredOverCap === null && measured <= cap) {
      return;
    }

    this.logger.warn(
      `OpenAI response exceeded the ${cap}-byte transport cap ` +
        `(declared=${declaredOverCap ?? 'n/a'} measured=${measured}). ` +
        `correlationId=${correlationId}`,
    );

    throw new TryOnProviderError(
      ErrorCode.UPSTREAM_INVALID_RESPONSE,
      'The upstream response exceeded the permitted size.',
      response.status,
    );
  }

  private parseBody(raw: Buffer, status: number): OpenAiResponseBody {
    try {
      return JSON.parse(raw.toString('utf8')) as OpenAiResponseBody;
    } catch (error: unknown) {
      if (status >= 200 && status < 300) {
        throw new TryOnProviderError(
          ErrorCode.UPSTREAM_INVALID_RESPONSE,
          'The upstream returned a body that is not JSON.',
          status,
          { cause: error },
        );
      }
      return {};
    }
  }

  private classifyText(text: string): TryOnProviderErrorCode | null {
    const haystack = text.slice(0, MAX_ERROR_SNIPPET).toLowerCase();
    if (haystack.length === 0) {
      return null;
    }
    for (const [pattern, code] of BODY_CODE_PATTERNS) {
      if (pattern.test(haystack)) {
        return code;
      }
    }
    return null;
  }

  private classifyError(parsed: OpenAiResponseBody, status: number): TryOnProviderErrorCode {
    const error = parsed.error;
    const detail = `${error?.code ?? ''} ${error?.type ?? ''} ${error?.message ?? ''}`;

    return this.classifyText(detail) ?? this.classifyStatus(status);
  }

  private classifyStatus(status: number): TryOnProviderErrorCode {
    if (status === 401 || status === 403 || status === 404) {
      return ErrorCode.TRYON_PROVIDER_MISCONFIGURED;
    }
    if (status === 408 || status === 504) {
      return ErrorCode.UPSTREAM_TIMEOUT;
    }
    if (status === 429) {
      return ErrorCode.UPSTREAM_RATE_LIMITED;
    }
    if (status >= 500) {
      return ErrorCode.UPSTREAM_UNAVAILABLE;
    }
    if (status === 400 || status === 413 || status === 415 || status === 422) {
      return ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT;
    }
    return ErrorCode.UPSTREAM_INVALID_RESPONSE;
  }

  private rejection(
    status: number,
    code: TryOnProviderErrorCode,
    correlationId: string,
  ): TryOnProviderError {
    this.logger.warn(
      `OpenAI rejected the generation: status=${status} code=${code} ` +
        `correlationId=${correlationId}`,
    );
    return new TryOnProviderError(code, `OpenAI responded ${status} (${code}).`, status);
  }

  private async toPng(bytes: Buffer): Promise<Buffer> {
    try {
      const image = sharp(bytes);
      const format = (await image.metadata()).format;
      return format === 'png' ? bytes : await image.png().toBuffer();
    } catch (error: unknown) {
      throw new TryOnProviderError(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
        'The upstream returned bytes that are not a readable image.',
        undefined,
        { cause: error },
      );
    }
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
