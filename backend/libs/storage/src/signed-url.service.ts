/**
 * ARCHITECTURE.md §3.4 (signed download URLs) and §3.5 (upload tickets).
 *
 * ```
 * token   = base64url(payload) + "." + base64url(HMAC-SHA256(base64url(payload), STORAGE_URL_SECRET)[0..15])
 * payload = JSON.stringify({ key, exp, sub? })        // compact, keys in this order
 * ```
 *
 * The MAC is truncated to its first 128 bits — a deliberate §3.4 deviation (2026-08-12). The full
 * person-photo token was 262 characters, and Windows http.sys rejects any URL segment over 260 by
 * default (`UrlSegmentMaxLength`), killing the request before it reaches any application code.
 * Truncation to 128 bits is the standard remedy (RFC 2104 §5 explicitly permits truncation to no
 * less than half the digest); forging a link still takes 2^128 work, and every token now fits any
 * host's default limits with room to spare. Deploying this invalidates outstanding URLs — which
 * expire within minutes anyway and is the documented STORAGE_URL_SECRET rotation behaviour.
 *
 * The token is opaque to the frontend. A storage key must never cross the network boundary, so the
 * only thing a response DTO ever carries is the finished URL.
 *
 * Upload tickets use the same construction with a `"upload:"` domain separator prefixed to the
 * signed string, so a download token can never be replayed as an upload token and vice versa.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  fileTokenExpired,
  fileTokenInvalid,
  fileTokenSubjectMismatch,
  uploadTicketExpired,
  uploadTicketInvalid,
} from './exceptions/storage.exception';
import { assertValidStorageKey, isValidStorageKey, keyPrefixSegment } from './storage-key.builder';
import { STORAGE_CONFIG, URL_EXPIRY_BUCKET_SECONDS, type StorageConfig } from './storage.config';

// Re-exported from where it is asserted. The value belongs beside the TTLs it constrains
// (`assertTtlsOutliveTheExpiryBucket`); the name stays importable from here because that is
// where every caller and the barrel already look for it.
export { URL_EXPIRY_BUCKET_SECONDS };

export interface SignedUrlPayload {
  /** storage key */
  key: string;
  /** Unix seconds */
  exp: number;
  /** owning userId — present for every private object */
  sub?: string;
  /**
   * The **credential** this token is bound to, as `<scheme>:<id>` — currently only
   * `share-link:<uuid>`.
   *
   * `sub` binds a token to a session. Some objects are handed to somebody who has no
   * session and never will: a share-page thumbnail (C-33) is read by a recipient whose
   * only authorisation is the link itself. `aud` is the equivalent for them — the token
   * is valid only while the credential that produced it is still live, so revoking the
   * link (C-34, "revocable at any time") invalidates every URL it ever minted rather
   * than only the next one.
   *
   * Liveness is decided by whoever owns the credential, through
   * {@link SignedUrlAudienceRegistry}; this service only carries the claim and proves it
   * was not tampered with.
   */
  aud?: string;
}

/** §3.5 — the upload ticket payload, signed under the `"upload:"` domain. */
export interface UploadTicketPayload {
  key: string;
  exp: number;
  sub: string;
  maxBytes: number;
  contentType: string;
}

export interface IssueOptions {
  /** The userId the token is scoped to. Required for private object classes (§3.4). */
  subject?: string;
  /**
   * The credential the token is bound to, as `<scheme>:<id>`. See
   * {@link SignedUrlPayload.aud}. Used where the reader has no session to be a `sub`.
   */
  audience?: string;
  /** Overrides the class TTL from the §3.4 table. */
  ttlSeconds?: number;
  /** Injectable clock, for tests. */
  now?: Date;
}

export interface VerifyOptions {
  /** The requesting user's id. Compared with `sub` when the token carries one. */
  subject?: string;
  /** Injectable clock, for tests. */
  now?: Date;
}
export const UPLOAD_TICKET_HEADER = 'X-Upload-Ticket';

/** Prefixes whose objects are private to one account (§3.4 issuing rules). */
const BLURRED_MODERATION_PREFIX = 'thumbnails/person-blurred/';

const UPLOAD_DOMAIN_SEPARATOR = 'upload:';

/** 128 bits. See the file header for why the MAC is truncated and why that is sound. */
const TRUNCATED_MAC_BYTES = 16;

const SUBJECT_REQUIRED_SEGMENTS: ReadonlySet<string> = new Set([
  'person-photos',
  'renders',
  'exports',
]);

@Injectable()
export class SignedUrlService {
  constructor(@Inject(STORAGE_CONFIG) private readonly config: StorageConfig) {}

  subjectRequiredForKey(key: string): boolean {
    if (key.startsWith(BLURRED_MODERATION_PREFIX)) {
      return true;
    }
    return SUBJECT_REQUIRED_SEGMENTS.has(keyPrefixSegment(key));
  }

  /** The §3.4 TTL for the object class this key belongs to. */
  ttlSecondsForKey(key: string): number {
    if (key.startsWith(BLURRED_MODERATION_PREFIX)) {
      return this.config.photoUrlTtlSeconds;
    }
    switch (keyPrefixSegment(key)) {
      case 'person-photos':
        return this.config.photoUrlTtlSeconds;
      case 'renders':
      case 'exports':
        return this.config.renderUrlTtlSeconds;
      default:
        return this.config.publicUrlTtlSeconds;
    }
  }

  /* ---------------------------------------------------------------------------------------------
   * Download tokens
   * ------------------------------------------------------------------------------------------ */

  /**
   * Signs a token for `key`. Throws `FILE_TOKEN_SUBJECT_MISMATCH` when the class requires a subject
   * and none was given — issuing a subject-less token for a private object would hand out a
   * bearer URL for someone's photo.
   *
   * Two calls for the same key and subject inside one {@link URL_EXPIRY_BUCKET_SECONDS} window
   * return the **same** token, so the URL is a stable cache key. See the constant for why.
   */
  issue(key: string, options: IssueOptions = {}): string {
    assertValidStorageKey(key);
    if (options.subject !== undefined && options.subject === '') {
      throw fileTokenSubjectMismatch();
    }
    if (options.audience !== undefined && options.audience === '') {
      throw fileTokenSubjectMismatch();
    }
    if (this.subjectRequiredForKey(key) && options.subject === undefined) {
      throw fileTokenSubjectMismatch();
    }
    const nowSeconds = bucketedIssuedAtSeconds(options.now);
    const ttl = options.ttlSeconds ?? this.ttlSecondsForKey(key);
    return this.sign({
      key,
      exp: nowSeconds + ttl,
      ...(options.subject === undefined ? {} : { sub: options.subject }),
      ...(options.audience === undefined ? {} : { aud: options.audience }),
    });
  }

  /** The ready-to-use URL a response DTO carries: `{APP_API_URL}/api/v1/files/{token}`. */
  issueUrl(key: string, options: IssueOptions = {}): string {
    return this.buildDownloadUrl(this.issue(key, options));
  }

  buildDownloadUrl(token: string): string {
    return `${this.config.apiBaseUrl}/api/v1/files/${token}`;
  }

  /** Signs an already-built payload. Exposed for tests and for re-signing a copied render. */
  sign(payload: SignedUrlPayload): string {
    const encoded = encodePayload({
      key: payload.key,
      exp: payload.exp,
      ...(payload.sub === undefined ? {} : { sub: payload.sub }),
      ...(payload.aud === undefined ? {} : { aud: payload.aud }),
    });
    return `${encoded}.${this.hmac(encoded)}`;
  }

  verify(token: string, options: VerifyOptions = {}): SignedUrlPayload {
    const parts = splitToken(token);
    if (parts === null) {
      throw fileTokenInvalid();
    }

    if (!this.signatureMatches(parts.encodedPayload, parts.signature)) {
      throw fileTokenInvalid();
    }

    const payload = decodeDownloadPayload(parts.encodedPayload);

    const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
    if (payload.exp <= nowSeconds) {
      throw fileTokenExpired();
    }

    if (payload.sub !== undefined && payload.sub !== options.subject) {
      throw fileTokenSubjectMismatch();
    }

    return payload;
  }

  /** Seconds left on the token — §3.4 step 6 uses it for `Cache-Control: private, max-age=…`. */
  remainingTtlSeconds(payload: SignedUrlPayload, now: Date = new Date()): number {
    return Math.max(0, payload.exp - Math.floor(now.getTime() / 1000));
  }

  /* ---------------------------------------------------------------------------------------------
   * Upload tickets (§3.5)
   * ------------------------------------------------------------------------------------------ */

  issueUploadTicket(
    key: string,
    options: {
      contentType: string;
      maxBytes: number;
      ttlSeconds: number;
      subject: string;
      now?: Date;
    },
  ): { token: string; payload: UploadTicketPayload } {
    assertValidStorageKey(key);

    if (options.subject === '') {
      throw uploadTicketInvalid();
    }
    const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
    const payload: UploadTicketPayload = {
      key,
      exp: nowSeconds + options.ttlSeconds,
      sub: options.subject,
      maxBytes: options.maxBytes,
      contentType: options.contentType,
    };
    const encoded = encodePayload(payload);
    return { token: `${encoded}.${this.hmac(UPLOAD_DOMAIN_SEPARATOR + encoded)}`, payload };
  }


  buildUploadUrl(): string {
    return `${this.config.apiBaseUrl}/api/v1/files/upload`;
  }

  verifyUploadTicket(token: string, options: VerifyOptions = {}): UploadTicketPayload {
    const parts = splitToken(token);
    if (parts === null) {
      throw uploadTicketInvalid();
    }

    if (!this.signatureMatches(UPLOAD_DOMAIN_SEPARATOR + parts.encodedPayload, parts.signature)) {
      throw uploadTicketInvalid();
    }

    const payload = decodeUploadPayload(parts.encodedPayload);

    const nowSeconds = Math.floor((options.now?.getTime() ?? Date.now()) / 1000);
    if (payload.exp <= nowSeconds) {
      throw uploadTicketExpired();
    }

    if (payload.sub === '' || payload.sub !== options.subject) {
      throw uploadTicketInvalid();
    }

    return payload;
  }

  /* ---------------------------------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------------------------------ */

  private hmac(signedString: string): string {
    return createHmac('sha256', this.config.urlSecret)
      .update(signedString)
      .digest()
      .subarray(0, TRUNCATED_MAC_BYTES)
      .toString('base64url');
  }

  /** Constant-time comparison. Length is compared first because `timingSafeEqual` throws otherwise. */
  private signatureMatches(signedString: string, providedSignature: string): boolean {
    const expected = Buffer.from(this.hmac(signedString), 'utf8');
    const provided = Buffer.from(providedSignature, 'utf8');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}

/* -------------------------------------------------------------------------------------------------
 * Pure helpers
 * ---------------------------------------------------------------------------------------------- */

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function bucketedIssuedAtSeconds(now: Date | undefined): number {
  const seconds = Math.floor((now?.getTime() ?? Date.now()) / 1000);
  return Math.floor(seconds / URL_EXPIRY_BUCKET_SECONDS) * URL_EXPIRY_BUCKET_SECONDS;
}

function splitToken(token: string): { encodedPayload: string; signature: string } | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return null;
  }
  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) {
    return null;
  }
  return {
    encodedPayload: token.slice(0, separator),
    signature: token.slice(separator + 1),
  };
}

function parseJsonObject(encodedPayload: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch (cause) {
    throw fileTokenInvalid(cause);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw fileTokenInvalid();
  }
  return parsed as Record<string, unknown>;
}

function decodeDownloadPayload(encodedPayload: string): SignedUrlPayload {
  const raw = parseJsonObject(encodedPayload);
  const { key, exp, sub, aud } = raw;
  if (typeof key !== 'string' || typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw fileTokenInvalid();
  }
  // `''` is rejected as well as a non-string: a token carrying an empty `sub` would be
  // "scoped" to a subject no session can ever match, and `issue` refuses to mint one.
  if (sub !== undefined && (typeof sub !== 'string' || sub === '')) {
    throw fileTokenInvalid();
  }
  if (aud !== undefined && (typeof aud !== 'string' || aud === '')) {
    throw fileTokenInvalid();
  }
  // A token whose HMAC is valid but whose key is not is only reachable if the secret leaked; reject
  // it here so `assertInsideRoot` is never the last line of defence.
  if (!isValidStorageKey(key)) {
    throw fileTokenInvalid();
  }
  return {
    key,
    exp,
    ...(sub === undefined ? {} : { sub }),
    ...(aud === undefined ? {} : { aud }),
  };
}

function decodeUploadPayload(encodedPayload: string): UploadTicketPayload {
  let raw: Record<string, unknown>;
  try {
    raw = parseJsonObject(encodedPayload);
  } catch (cause) {
    throw uploadTicketInvalid(cause);
  }
  const { key, exp, sub, maxBytes, contentType } = raw;
  if (
    typeof key !== 'string' ||
    typeof exp !== 'number' ||
    !Number.isFinite(exp) ||
    typeof sub !== 'string' ||
    typeof maxBytes !== 'number' ||
    !Number.isInteger(maxBytes) ||
    maxBytes <= 0 ||
    typeof contentType !== 'string' ||
    !isValidStorageKey(key)
  ) {
    throw uploadTicketInvalid();
  }
  return { key, exp, sub, maxBytes, contentType };
}
