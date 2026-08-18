import { ErrorCode } from '@library/common';

export const TRYON_PROVIDER = Symbol('TRYON_PROVIDER');

export interface TryOnGenerationRequest {
  readonly garmentImage: Buffer;
  readonly garmentImageMimeType: string;
  readonly personImage: Buffer;
  readonly personImageMimeType: string;
  readonly correlationId: string;
}

export interface TryOnGenerationResult {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly attempts: number;
}

export interface TryOnProvider {
  readonly name: 'mock' | 'http' | 'gemini' | 'openai';

  generate(request: TryOnGenerationRequest): Promise<TryOnGenerationResult>;
}

export type TryOnProviderErrorCode =
  | ErrorCode.UPSTREAM_NO_GARMENT_DETECTED
  | ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT
  | ErrorCode.MODERATION_REJECTED
  | ErrorCode.UPSTREAM_TIMEOUT
  | ErrorCode.UPSTREAM_UNAVAILABLE
  | ErrorCode.UPSTREAM_RATE_LIMITED
  | ErrorCode.UPSTREAM_INVALID_RESPONSE
  | ErrorCode.TRYON_PROVIDER_MISCONFIGURED;

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

export class TryOnProviderError extends Error {
  constructor(
    readonly errorCode: TryOnProviderErrorCode,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TryOnProviderError';
  }
}

export function isTryOnProviderError(value: unknown): value is TryOnProviderError {
  return value instanceof TryOnProviderError;
}
