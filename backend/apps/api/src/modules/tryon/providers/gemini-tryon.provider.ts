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

const API_KEY_HEADER = 'x-goog-api-key';

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

const PERSON_LABEL = 'Person photograph:';
const GARMENT_LABEL = 'Garment to fit onto the person:';

const MAX_ERROR_SNIPPET = 240;

const AXIOS_SIZE_ABORT = /max(content|body)length/i;

const REQUEST_IMAGES = 2;

const JSON_FRAMING_SLACK_BYTES = 64 * 1024;

function transportBoundFor(imageBytes: number): number {
  return Math.ceil((imageBytes * 4) / 3) + JSON_FRAMING_SLACK_BYTES;
}

const FINISH_REASON_CODES: Readonly<Record<string, TryOnProviderErrorCode>> = {
  SAFETY: ErrorCode.MODERATION_REJECTED,
  IMAGE_SAFETY: ErrorCode.MODERATION_REJECTED,
  PROHIBITED_CONTENT: ErrorCode.MODERATION_REJECTED,
  BLOCKLIST: ErrorCode.MODERATION_REJECTED,
  SPII: ErrorCode.MODERATION_REJECTED,
  RECITATION: ErrorCode.UPSTREAM_INVALID_RESPONSE,
  MAX_TOKENS: ErrorCode.UPSTREAM_INVALID_RESPONSE,
  OTHER: ErrorCode.UPSTREAM_INVALID_RESPONSE,
};

const BODY_CODE_PATTERNS: readonly (readonly [RegExp, TryOnProviderErrorCode])[] = [
  [
    /api[_ -]?key|permission[_ -]?denied|unauthenticated|unauthori[sz]ed|forbidden|billing|consumer_suspended/,
    ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
  ],
  [
    /resource[_ -]?exhausted|rate[_ -]?limit|too[_ -]?many[_ -]?requests|quota/,
    ErrorCode.UPSTREAM_RATE_LIMITED,
  ],
  [
    /safety|blocked|policy|can'?t help|cannot help|unable to (help|assist|create|generate)|won'?t be able|not able to (help|assist|create|generate)|i'?m sorry|inappropriate|explicit|nsfw/,
    ErrorCode.MODERATION_REJECTED,
  ],
  [
    /no[_ -]?garment|garment[_ -]?not[_ -]?(found|detected)|no[_ -]?clothing|no (person|garment|clothing) (is )?(visible|present|detected)|cannot (see|identify) (a|the) (garment|person)/,
    ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
  ],
  [
    /unsupported|corrupt|invalid[_ -]?image|unsupported[_ -]?mime|bad[_ -]?format|decode|could not (be )?process/,
    ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
  ],
  [/deadline[_ -]?exceeded/, ErrorCode.UPSTREAM_TIMEOUT],
  [/unavailable|internal[_ -]?error|overloaded|try again later/, ErrorCode.UPSTREAM_UNAVAILABLE],
];

interface GeminiInlineData {
  readonly mimeType?: string;
  readonly data?: string;
}

interface GeminiPart {
  readonly text?: string;
  readonly inlineData?: GeminiInlineData;
  readonly inline_data?: GeminiInlineData;
}

interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly GeminiPart[] };
  readonly finishReason?: string;
}

interface GeminiResponseBody {
  readonly candidates?: readonly GeminiCandidate[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly error?: { readonly code?: number; readonly message?: string; readonly status?: string };
}

@Injectable()
export class GeminiTryOnProvider implements TryOnProvider {
  readonly name = 'gemini' as const;

  private readonly logger = new Logger(GeminiTryOnProvider.name);

  private readonly client: AxiosInstance;

  constructor(private readonly config: TryOnConfig) {
    this.client = axios.create({
      baseURL: config.geminiBaseUrl ?? undefined,
      timeout: config.timeoutMs,
      validateStatus: () => true,
      responseType: 'arraybuffer',
      maxRedirects: 0,
      maxContentLength: transportBoundFor(config.maxResponseBytes),
      maxBodyLength: transportBoundFor(config.maxResponseBytes * REQUEST_IMAGES),
      decompress: false,
    });
  }

  async generate(request: TryOnGenerationRequest): Promise<TryOnGenerationResult> {
    if (!this.config.isGeminiDriverUsable) {
      throw new TryOnProviderError(
        ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
        'TRYON_DRIVER=gemini with no base URL, model or API key.',
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
            `Gemini attempt ${attempt} failed (${error.errorCode}` +
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

  private async attempt(request: TryOnGenerationRequest, attempt: number): Promise<Buffer> {
    const path = `/models/${encodeURIComponent(this.config.geminiModel ?? '')}:generateContent`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            { text: PERSON_LABEL },
            {
              inlineData: {
                mimeType: request.personImageMimeType,
                data: request.personImage.toString('base64'),
              },
            },
            { text: GARMENT_LABEL },
            {
              inlineData: {
                mimeType: request.garmentImageMimeType,
                data: request.garmentImage.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'] },
    };

    let response: AxiosResponse<ArrayBuffer>;
    try {
      response = await this.client.post<ArrayBuffer>(path, body, {
        headers: {
          [API_KEY_HEADER]: this.config.readApiKey(TryOnDriverName.GEMINI) ?? '',
          'Content-Type': 'application/json',
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
        `Gemini response exceeded the transport cap on attempt ${attempt}. ` +
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
      `Gemini transport failure on attempt ${attempt}: ${code}. correlationId=${correlationId}`,
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

    const raw = Buffer.from(response.data);
    const parsed = this.parseBody(raw, status);

    if (status < 200 || status >= 300) {
      throw this.rejection(status, this.classifyError(parsed, status), correlationId);
    }

    const blockReason = parsed.promptFeedback?.blockReason;
    if (blockReason !== undefined && blockReason.length > 0) {
      const code = FINISH_REASON_CODES[blockReason.toUpperCase()] ?? ErrorCode.MODERATION_REJECTED;
      this.logger.warn(
        `Gemini blocked the prompt: blockReason=${blockReason} code=${code} ` +
          `correlationId=${correlationId}`,
      );
      throw new TryOnProviderError(code, `Gemini blocked the prompt (${blockReason}).`, status);
    }

    const candidate = parsed.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    const image = this.firstImagePart(parts);
    if (image !== null) {
      const bytes = Buffer.from(image, 'base64');
      if (bytes.length === 0) {
        throw new TryOnProviderError(
          ErrorCode.UPSTREAM_INVALID_RESPONSE,
          'The upstream returned an empty image.',
          status,
        );
      }
      if (bytes.length > this.config.maxResponseBytes) {
        this.logger.warn(
          `Gemini render exceeded the ${this.config.maxResponseBytes}-byte cap ` +
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

    const finishReason = candidate?.finishReason;
    const fromFinish =
      finishReason === undefined || finishReason.toUpperCase() === 'STOP'
        ? null
        : (FINISH_REASON_CODES[finishReason.toUpperCase()] ?? null);

    const code =
      fromFinish ?? this.classifyText(this.textOf(parts)) ?? ErrorCode.UPSTREAM_INVALID_RESPONSE;

    this.logger.warn(
      `Gemini returned no image: status=${status} ` +
        `finishReason=${finishReason ?? 'none'} code=${code} correlationId=${correlationId}`,
    );

    throw new TryOnProviderError(
      code,
      `Gemini answered ${status} without an image (${code}).`,
      status,
    );
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
      `Gemini response exceeded the ${cap}-byte transport cap ` +
        `(declared=${declaredOverCap ?? 'n/a'} measured=${measured}). ` +
        `correlationId=${correlationId}`,
    );

    throw new TryOnProviderError(
      ErrorCode.UPSTREAM_INVALID_RESPONSE,
      'The upstream response exceeded the permitted size.',
      response.status,
    );
  }

  private parseBody(raw: Buffer, status: number): GeminiResponseBody {
    try {
      return JSON.parse(raw.toString('utf8')) as GeminiResponseBody;
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

  private firstImagePart(parts: readonly GeminiPart[]): string | null {
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      const data = inline?.data;
      if (data !== undefined && data.length > 0) {
        return data;
      }
    }
    return null;
  }

  private textOf(parts: readonly GeminiPart[]): string {
    return parts
      .map((part) => part.text ?? '')
      .join(' ')
      .slice(0, MAX_ERROR_SNIPPET)
      .toLowerCase();
  }

  private classifyText(text: string): TryOnProviderErrorCode | null {
    if (text.length === 0) {
      return null;
    }
    for (const [pattern, code] of BODY_CODE_PATTERNS) {
      if (pattern.test(text)) {
        return code;
      }
    }
    return null;
  }

  private classifyError(parsed: GeminiResponseBody, status: number): TryOnProviderErrorCode {
    const detail = `${parsed.error?.status ?? ''} ${parsed.error?.message ?? ''}`
      .slice(0, MAX_ERROR_SNIPPET)
      .toLowerCase();

    return this.classifyText(detail) ?? this.classifyStatus(status);
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

  private rejection(
    status: number,
    code: TryOnProviderErrorCode,
    correlationId: string,
  ): TryOnProviderError {
    this.logger.warn(
      `Gemini rejected the generation: status=${status} code=${code} ` +
        `correlationId=${correlationId}`,
    );
    return new TryOnProviderError(code, `Gemini responded ${status} (${code}).`, status);
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
