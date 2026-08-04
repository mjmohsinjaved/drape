import { createHash } from 'node:crypto';

/** Lower-case hex sha256 of a buffer or a UTF-8 string. */
export function sha256Hex(input: Buffer | string): string {
  const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(data).digest('hex');
}

/** Lower-case hex sha256 of a lower-cased, trimmed email — `users.emailHash` (E-12). */
export function sha256EmailHex(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

/** The separator joining the three cache-key components (§3.7). */
export const TRYON_CACHE_KEY_SEPARATOR = ':';

/** The inputs to the content-hash cache key. */
export interface TryOnCacheKeyInput {
  /** `garment_images.hash` of the try-on source image. */
  garmentSourceHash: string;
  /** `person_photos.hash`. */
  personPhotoHash: string;
  /** `TRYON_API_VERSION`. Bumping it invalidates the whole cache without a migration. */
  tryOnApiVersion: string;
}

/**
 * The content-hash cache key — ARCHITECTURE.md §3.7, PRD §8.1 step 4.
 *
 * ```
 * cacheKey = sha256(`${garmentSourceHash}:${personPhotoHash}:${TRYON_API_VERSION}`)
 * ```
 *
 * Both hashes are the sha256 the storage driver returned on write. The component
 * order is part of the contract — changing it silently invalidates every cached
 * render, so it is fixed here and nowhere else.
 *
 * @throws {Error} when any component is empty or contains the separator, which
 * would make the concatenation ambiguous.
 */
export function buildTryOnCacheKey(input: TryOnCacheKeyInput): string {
  const components: ReadonlyArray<readonly [string, string]> = [
    ['garmentSourceHash', input.garmentSourceHash],
    ['personPhotoHash', input.personPhotoHash],
    ['tryOnApiVersion', input.tryOnApiVersion],
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

/** true when `value` looks like a lower-case hex sha256 digest. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * A short, non-reversible fingerprint of a value, for correlating log lines without
 * writing the value itself (E-12). 12 hex characters — enough to correlate, far too
 * few to brute-force back to an email or a token of any real entropy.
 */
export function fingerprint(input: Buffer | string, length = 12): string {
  return sha256Hex(input).slice(0, Math.max(4, Math.min(64, length)));
}
