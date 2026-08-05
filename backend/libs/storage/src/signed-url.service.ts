/**
 * ARCHITECTURE.md §3.4 (signed download URLs) and §3.5 (upload tickets).
 *
 * ```
 * token   = base64url(payload) + "." + base64url(HMAC-SHA256(base64url(payload), STORAGE_URL_SECRET))
 * payload = JSON.stringify({ key, exp, sub? })        // compact, keys in this order
 * ```
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
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';

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

/** Prefixes whose objects are private to one account (§3.4 issuing rules). */
const BLURRED_MODERATION_PREFIX = 'thumbnails/person-blurred/';

const UPLOAD_DOMAIN_SEPARATOR = 'upload:';

/**
 * The key namespaces that are private to exactly one account and therefore require a `sub`.
 *
 * A **set**, not a chain of `||`, so adding a namespace is one line in one place rather
 * than an edit to two switch statements that have to agree. `exports/**` was missing from
 * the old chain for exactly as long as it took somebody to notice: an archive holds up to
 * five hundred full-resolution renders of one consumer's body, and issuing it without a
 * subject would have minted a session-less bearer URL to her entire history. The single
 * caller did pass a subject — but a guard whose whole job is to make forgetting impossible
 * has to cover the class, not rely on the call site.
 */
const SUBJECT_REQUIRED_SEGMENTS: ReadonlySet<string> = new Set([
  'person-photos',
  'renders',
  'exports',
]);

/**
 * **The window `exp` is quantised to — the reason a signed URL is cacheable at all.**
 *
 * `exp` used to be stamped from the exact millisecond of the call, so asking for the same object
 * twice produced two different tokens, two different URLs and therefore two different cache keys.
 * Nothing downstream could reuse anything: not the browser, not a CDN, and not Next's image
 * optimiser, whose cache key *is* the URL — which is why `next.config.ts`'s `minimumCacheTTL: 300`
 * was inert and why one component had already fallen back to a plain `<img>`.
 *
 * Quantising the **issue instant** — not the expiry — is what makes it safe. `exp` becomes
 * `floor(now / bucket) * bucket + ttl`, so every call inside the same two-minute window signs a
 * byte-identical payload and yields a byte-identical URL, while the token still expires, is still
 * subject-scoped and is still tamper-evident. Nothing about *what* is signed changed; only when the
 * clock is read.
 *
 * Rounding down rather than up is deliberate: it can only ever shorten a token's life (to at worst
 * `ttl - bucket`), never extend it past the §3.4 TTL for its object class. A photo URL that lived
 * longer than §3.4 says it may would be a security change dressed up as a cache fix.
 *
 * Upload tickets are **not** bucketed: a ticket is used once by one client, nothing caches it, and
 * shortening its life by up to two minutes would buy nothing and cost a retry.
 */
export const URL_EXPIRY_BUCKET_SECONDS = 120;

@Injectable()
export class SignedUrlService {
  constructor(@Inject(STORAGE_CONFIG) private readonly config: StorageConfig) {}

  /* ---------------------------------------------------------------------------------------------
   * §3.4 issuing rules
   * ------------------------------------------------------------------------------------------ */

  /**
   * `true` when the object class requires a `sub` — `person-photos/**`, `renders/**`,
   * `exports/**` and `thumbnails/person-blurred/**`. For the blurred moderation thumbnail the
   * subject is the reviewing **admin's** id (A-34), not the consumer's: the unblurred photo is
   * never readable by an admin (S-10).
   */
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
      // An archive is a container full of renders, so it takes the render TTL. The
      // public TTL it used to fall through to is four times longer, which is the wrong
      // direction for the single most concentrated object in the store.
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
    // An empty string is not a subject. Passing one used to be indistinguishable from
    // passing nothing at the issuing check, and then *distinguishable* at verification —
    // `payload.sub !== undefined` would be true for `''`, so the token looked scoped while
    // matching no session at all. Rejected outright, for every key class: there is no
    // caller for whom "scoped to nobody" is the intended outcome.
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
    // Key order is part of the contract at the top of this file: two calls with the same
    // claims must produce byte-identical JSON, or the URL stops being a stable cache key.
    const encoded = encodePayload({
      key: payload.key,
      exp: payload.exp,
      ...(payload.sub === undefined ? {} : { sub: payload.sub }),
      ...(payload.aud === undefined ? {} : { aud: payload.aud }),
    });
    return `${encoded}.${this.hmac(encoded)}`;
  }

  /**
   * §3.4 verification, in the order the contract specifies:
   *
   * 1. split on the last `.` — malformed → `FILE_TOKEN_INVALID`;
   * 2. recompute the HMAC and compare with `timingSafeEqual` — mismatch → `FILE_TOKEN_INVALID`;
   * 3. parse the payload; `exp` in the past → `FILE_TOKEN_EXPIRED`;
   * 4. if `sub` is present, it must equal `options.subject` → `FILE_TOKEN_SUBJECT_MISMATCH`.
   *
   * Step 4 is what stops a render URL being replayed by another account (PRD §9.2). The single
   * documented exception — an `ADMIN` reading a `thumbnails/person-blurred/**` key whose `sub` is
   * their own id — needs no special case here: the controller passes the admin's own session id as
   * `subject`, because that is exactly whose id the token was issued to (A-34).
   */
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
    // §3.5: a ticket is always scoped to the account that will own the bytes. An empty
    // `sub` would sail through `verifyUploadTicket` for a caller with no session at all,
    // because `''` compares equal to the `''` a session-less redemption would supply —
    // and `POST /files/upload/:token` is a `@Public()` route. Unreachable today; refused
    // here so it stays unreachable.
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

  buildUploadUrl(token: string): string {
    return `${this.config.apiBaseUrl}/api/v1/files/upload/${token}`;
  }

  /**
   * Same order as §3.4, with the upload error family: malformed or wrong-domain →
   * `UPLOAD_TICKET_INVALID`, expired → `UPLOAD_TICKET_EXPIRED`, wrong account →
   * `UPLOAD_TICKET_INVALID` (an upload ticket has no separate "not yours" code in §2.4, and telling
   * an attacker which of the two it was buys them nothing).
   */
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

    // The empty check comes first and is unconditional. Without it a ticket whose `sub`
    // is `''` — which `issueUploadTicket` now refuses to mint, but an older token or a
    // leaked secret could still present — would be redeemable by a caller supplying `''`.
    if (payload.sub === '' || payload.sub !== options.subject) {
      throw uploadTicketInvalid();
    }

    return payload;
  }

  /* ---------------------------------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------------------------------ */

  private hmac(signedString: string): string {
    return createHmac('sha256', this.config.urlSecret).update(signedString).digest('base64url');
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

// Takes `object` rather than `Record<string, unknown>`: an interface has no
// implicit index signature, so the payload types would not be assignable.
function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * The issue instant, rounded **down** to {@link URL_EXPIRY_BUCKET_SECONDS}.
 *
 * Every download token minted inside one window therefore carries the same `exp` and hashes to
 * the same signature — an identical URL, which is the only thing a cache downstream can key on.
 */
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
