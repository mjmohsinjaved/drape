import { createHash } from 'node:crypto';

export function sha256Hex(input: Buffer | string): string {
  const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(data).digest('hex');
}

export function sha256EmailHex(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

export const TRYON_CACHE_KEY_SEPARATOR = ':';

export interface TryOnCacheKeyInput {
  garmentSourceHash: string;
  personPhotoHash: string;
  tryOnApiVersion: string;
  driver: string;
}

export function buildTryOnCacheKey(input: TryOnCacheKeyInput): string {
  const components: ReadonlyArray<readonly [string, string]> = [
    ['garmentSourceHash', input.garmentSourceHash],
    ['personPhotoHash', input.personPhotoHash],
    ['tryOnApiVersion', input.tryOnApiVersion],
    ['driver', input.driver],
  ];

  for (const [name, value] of components) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`buildTryOnCacheKey: "${name}" must be a non-empty string`);
    }
    if (value.includes(TRYON_CACHE_KEY_SEPARATOR)) {
      throw new Error(
        `buildTryOnCacheKey: "${name}" must not contain "${TRYON_CACHE_KEY_SEPARATOR}"`,
      );
    }
  }

  return sha256Hex(components.map(([, value]) => value).join(TRYON_CACHE_KEY_SEPARATOR));
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function fingerprint(input: Buffer | string, length = 12): string {
  return sha256Hex(input).slice(0, Math.max(4, Math.min(64, length)));
}
