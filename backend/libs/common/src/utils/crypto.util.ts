import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** Encodings an HMAC signature may be rendered in. */
export type SignatureEncoding = 'base64url' | 'hex';

/** Default signature encoding — matches the §3.4 signed-URL construction. */
export const DEFAULT_SIGNATURE_ENCODING: SignatureEncoding = 'base64url';

/**
 * A cryptographically random token.
 *
 * @param byteLength entropy in bytes — 32 gives 256 bits. Minimum 16.
 * @param encoding   `base64url` (default, URL- and cookie-safe) or `hex`.
 */
export function randomToken(byteLength = 32, encoding: SignatureEncoding = 'base64url'): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new Error('randomToken: byteLength must be an integer of at least 16');
  }
  return randomBytes(byteLength).toString(encoding);
}

/** A cryptographically random lower-case hex string of `byteLength` bytes. */
export function randomHex(byteLength = 32): string {
  return randomToken(byteLength, 'hex');
}

/** A v4 UUID. Thin wrapper so call sites do not each import `node:crypto`. */
export function randomId(): string {
  return randomUUID();
}

/**
 * Constant-time comparison of two strings.
 *
 * Compares fixed-width sha256-free digests of equal length only; unequal lengths
 * return false immediately, which leaks length and nothing else. Both operands are
 * compared through `crypto.timingSafeEqual`, so no early-exit byte comparison
 * reveals how much of a secret an attacker guessed.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Constant-time comparison of two buffers. */
export function timingSafeEqualBuffer(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function assertSecret(secret: string, caller: string): void {
  // No secret ever has a fallback default (E-2, CLAUDE.md). An empty secret is a
  // configuration failure, not something to paper over with a constant.
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error(`${caller}: a non-empty secret is required`);
  }
}

/**
 * HMAC-SHA256 of `payload` under `secret`.
 *
 * @param domain optional domain separator prefixed to the signed string, so a token
 * minted for one purpose can never be replayed as another (§3.5 uses `"upload:"`).
 */
export function hmacSign(
  payload: string,
  secret: string,
  options: { encoding?: SignatureEncoding; domain?: string } = {},
): string {
  assertSecret(secret, 'hmacSign');
  const encoding = options.encoding ?? DEFAULT_SIGNATURE_ENCODING;
  const signedString = options.domain === undefined ? payload : `${options.domain}${payload}`;
  return createHmac('sha256', secret).update(signedString, 'utf8').digest(encoding);
}

/**
 * Verifies an HMAC-SHA256 signature in constant time.
 *
 * Recomputes the expected signature and compares it with `timingSafeEqual`, so a
 * forged signature reveals nothing about how close it was.
 */
export function hmacVerify(
  payload: string,
  signature: string,
  secret: string,
  options: { encoding?: SignatureEncoding; domain?: string } = {},
): boolean {
  assertSecret(secret, 'hmacVerify');
  if (typeof signature !== 'string' || signature.length === 0) {
    return false;
  }
  return timingSafeEqualString(hmacSign(payload, secret, options), signature);
}

/** base64url-encodes a UTF-8 string. Used for the §3.4 signed-URL payload. */
export function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/** Decodes a base64url string. Returns `null` when the input is not valid base64url. */
export function base64UrlDecode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    return null;
  }
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}
