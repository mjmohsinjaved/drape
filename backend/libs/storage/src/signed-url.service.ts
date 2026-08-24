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

export { URL_EXPIRY_BUCKET_SECONDS };

export interface SignedUrlPayload {
  key: string;
  exp: number;
  sub?: string;
  aud?: string;
}

export interface UploadTicketPayload {
  key: string;
  exp: number;
  sub: string;
  maxBytes: number;
  contentType: string;
}

export interface IssueOptions {
  subject?: string;
  audience?: string;
  ttlSeconds?: number;
  now?: Date;
}

export interface VerifyOptions {
  subject?: string;
  now?: Date;
}
export const UPLOAD_TICKET_HEADER = 'X-Upload-Ticket';

const BLURRED_MODERATION_PREFIX = 'thumbnails/person-blurred/';

const UPLOAD_DOMAIN_SEPARATOR = 'upload:';

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

  issueUrl(key: string, options: IssueOptions = {}): string {
    return this.buildDownloadUrl(this.issue(key, options));
  }

  buildDownloadUrl(token: string): string {
    return `${this.config.apiBaseUrl}/api/v1/files/${token}`;
  }

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

  remainingTtlSeconds(payload: SignedUrlPayload, now: Date = new Date()): number {
    return Math.max(0, payload.exp - Math.floor(now.getTime() / 1000));
  }

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

  private hmac(signedString: string): string {
    return createHmac('sha256', this.config.urlSecret)
      .update(signedString)
      .digest()
      .subarray(0, TRUNCATED_MAC_BYTES)
      .toString('base64url');
  }

  private signatureMatches(signedString: string, providedSignature: string): boolean {
    const expected = Buffer.from(this.hmac(signedString), 'utf8');
    const provided = Buffer.from(providedSignature, 'utf8');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}

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
  if (sub !== undefined && (typeof sub !== 'string' || sub === '')) {
    throw fileTokenInvalid();
  }
  if (aud !== undefined && (typeof aud !== 'string' || aud === '')) {
    throw fileTokenInvalid();
  }
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
