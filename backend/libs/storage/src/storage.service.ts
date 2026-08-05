/**
 * ARCHITECTURE.md §3.1 — "`StorageService` is the only injected dependency. It wraps the driver,
 * adds key construction, signed-URL issuing, sha256 hashing, `sharp` post-processing and metric
 * emission."
 *
 * Every caller in `apps/api` talks to this class and nothing else. No feature module imports a
 * driver, touches `fs`, or joins a path onto a storage key.
 */
import { Readable } from 'node:stream';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { imageTooLarge, imageFormatUnsupported } from './exceptions/storage.exception';
import { SignedUrlService, type IssueOptions, type SignedUrlPayload } from './signed-url.service';
import {
  buildTryOnCacheKey,
  isAllowedUploadMimeType,
  normaliseMimeType,
  sha256,
  StoragePrefixes,
} from './storage-key.builder';
import { STORAGE_CONFIG, STORAGE_DRIVER_TOKEN, type StorageConfig } from './storage.config';

import type { StorageDriver, StoredObject, UploadTicket } from './drivers/storage-driver.interface';

/** What a put returns to a caller. Maps §3.1's `StoredObject` onto the columns a row needs. */
export interface PutResult {
  key: string;
  size: number;
  /** sha256, hex. Persisted as the `hash` column and used by the §3.7 content-hash cache. */
  sha256: string;
  mimeType: string;
}

export interface PutRequestOptions {
  contentType: string;
  /** Default true — a put never silently overwrites. */
  failIfExists?: boolean;
  cacheControl?: string;
  /** Hard ceiling for this write. Clamped to `STORAGE_MAX_UPLOAD_MB`. */
  maxBytes?: number;
}

export interface CreateUploadTicketRequest {
  /** Built by `StorageKeys.*` in the calling module — never concatenated by hand. */
  key: string;
  contentType: string;
  /** The userId the ticket is scoped to, so it cannot be redeemed by another account. */
  subject: string;
  maxBytes?: number;
  ttlSeconds?: number;
}

export interface FreeSpaceReport {
  freeBytes: number | null;
  minFreeBytes: number;
  /** `false` puts `/health/ready` into degraded and fires the E-14 alert. */
  ok: boolean;
}

function toStoredResult(object: StoredObject): PutResult {
  return {
    key: object.key,
    size: object.byteSize,
    sha256: object.etag,
    mimeType: object.contentType,
  };
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_DRIVER_TOKEN) private readonly driver: StorageDriver,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly signedUrls: SignedUrlService,
  ) {}

  /** §3.2 requirement 10 — free space is checked at startup as well as in `/health/ready`. */
  async onModuleInit(): Promise<void> {
    const report = await this.freeSpace();
    if (!report.ok) {
      this.logger.warn(
        `Storage free space is below STORAGE_MIN_FREE_MB (${report.freeBytes ?? 'unknown'} bytes free, ` +
          `${report.minFreeBytes} required).`,
      );
    }
  }

  /** Which driver is active. `files` uses it to decide whether it is in the upload data path. */
  get driverName(): StorageDriver['name'] {
    return this.driver.name;
  }

  /* ---------------------------------------------------------------------------------------------
   * Objects
   * ------------------------------------------------------------------------------------------ */

  async put(key: string, body: Buffer | Readable, options: PutRequestOptions): Promise<PutResult> {
    const maxBytes = this.effectiveMaxBytes(options.maxBytes);
    const stored = await this.driver.put(key, this.enforceMaxBytes(body, maxBytes), {
      contentType: normaliseMimeType(options.contentType),
      failIfExists: options.failIfExists ?? true,
      ...(options.cacheControl === undefined ? {} : { cacheControl: options.cacheControl }),
    });
    return toStoredResult(stored);
  }

  async get(key: string): Promise<Readable> {
    return this.driver.get(key);
  }

  async getBuffer(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.driver.get(key)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return Buffer.concat(chunks);
  }

  /** `null` when the object is absent. Carries the content type and sha256 §3.4 step 6 needs. */
  async head(key: string): Promise<StoredObject | null> {
    return this.driver.head(key);
  }

  /** Alias of `head`, for call sites that read as "stat this object". */
  async stat(key: string): Promise<StoredObject | null> {
    return this.driver.head(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  /** Idempotent — `false` when the object was already gone. */
  async delete(key: string): Promise<boolean> {
    return this.driver.delete(key);
  }

  /** Returns the number of objects removed, for `deletion_log.itemsDeleted` (§9.3). */
  async deletePrefix(prefix: string): Promise<number> {
    return this.driver.deletePrefix(prefix);
  }

  async copy(sourceKey: string, destinationKey: string): Promise<PutResult> {
    return toStoredResult(await this.driver.copy(sourceKey, destinationKey));
  }

  async list(prefix: string, limit?: number): Promise<StoredObject[]> {
    return this.driver.list(prefix, limit);
  }

  /**
   * §3.3 — deleting a consumer removes `person-photos/<userId>/` and `renders/<userId>/`. Thumbnail
   * keys recorded on her rows are deleted by the owning modules, which know them.
   */
  async deleteUserObjects(userId: string): Promise<number> {
    const photos = await this.deletePrefix(StoragePrefixes.personPhotosOfUser(userId));
    const renders = await this.deletePrefix(StoragePrefixes.rendersOfUser(userId));
    return photos + renders;
  }

  /* ---------------------------------------------------------------------------------------------
   * Signed URLs (§3.4)
   * ------------------------------------------------------------------------------------------ */

  /**
   * The ready-to-use, already-signed `url` a response DTO carries. `subject` is required for
   * `person-photos/**`, `renders/**` and `thumbnails/person-blurred/**`; passing it for a public
   * asset is harmless but pointless.
   */
  signedUrl(key: string, subject?: string): string {
    return this.signedUrls.issueUrl(key, subject === undefined ? {} : { subject });
  }

  /**
   * The same URL, with the full §3.4 issuing options.
   *
   * For the callers that need more than a subject: a shorter TTL than the object class
   * default, or an `aud` binding the token to a credential rather than a session — the
   * share page's thumbnails, whose reader has no account at all (C-33, C-34).
   */
  signedUrlWith(key: string, options: IssueOptions): string {
    return this.signedUrls.issueUrl(key, options);
  }

  /** The raw token, for callers that build their own URL shape (a download route, an export). */
  signToken(key: string, subject?: string): string {
    return this.signedUrls.issue(key, subject === undefined ? {} : { subject });
  }

  /** §3.4 verification, in the contract's order. Throws the typed `FILE_TOKEN_*` errors. */
  verifyToken(token: string, subject?: string): SignedUrlPayload {
    return this.signedUrls.verify(token, subject === undefined ? {} : { subject });
  }

  /** Seconds left on a verified token, for `Cache-Control: private, max-age=…` (§3.4 step 6). */
  remainingTtlSeconds(payload: SignedUrlPayload): number {
    return this.signedUrls.remainingTtlSeconds(payload);
  }

  /* ---------------------------------------------------------------------------------------------
   * Uploads (§3.5)
   * ------------------------------------------------------------------------------------------ */

  /**
   * Issues an upload target. The caller has already authorised the `purpose` against the requester's
   * role and built the key with `StorageKeys.*`.
   *
   * `ticket.isDirect` tells the client whether the bytes go to the API (local disk) or straight to
   * the bucket (S3 later) — the one thing that differs between the two, exposed once, here.
   */
  async createUploadTicket(request: CreateUploadTicketRequest): Promise<UploadTicket> {
    this.assertAllowedUploadMimeType(request.contentType);
    return this.driver.createUploadTicket(request.key, {
      contentType: normaliseMimeType(request.contentType),
      maxBytes: this.effectiveMaxBytes(request.maxBytes),
      ttlSeconds: request.ttlSeconds ?? this.config.uploadTicketTtlSeconds,
      subject: request.subject,
    });
  }

  /**
   * Redeems a ticket by streaming the bytes to disk. Never buffers the whole file.
   *
   * Enforced here: the ticket's signature, expiry and subject; the MIME allow-list (HEIC, WebP, PNG,
   * JPEG per PRD A-10); and the byte ceiling, which cuts the stream off mid-flight rather than
   * discovering the overrun after the file has landed. The driver additionally checks the magic
   * bytes against the declared type (§3.2 requirement 9).
   *
   * A direct-upload driver never reaches this method — the client PUTs to the bucket instead.
   */
  async redeemUploadTicket(
    token: string,
    body: Buffer | Readable,
    subject: string,
  ): Promise<PutResult> {
    const ticket = this.signedUrls.verifyUploadTicket(token, { subject });
    this.assertAllowedUploadMimeType(ticket.contentType);
    return this.put(ticket.key, body, {
      contentType: ticket.contentType,
      failIfExists: true,
      maxBytes: ticket.maxBytes,
    });
  }

  /* ---------------------------------------------------------------------------------------------
   * Hashing (§3.2 requirement 7, §3.7)
   * ------------------------------------------------------------------------------------------ */

  /** The sha256 a caller persists as `hash`. Identical to the `etag` a put returns. */
  contentHash(bytes: Buffer): string {
    return sha256(bytes);
  }

  /** §3.7 — `sha256(garmentSourceHash:personPhotoHash:TRYON_API_VERSION)`. */
  cacheKey(garmentSourceHash: string, personPhotoHash: string, apiVersion: string): string {
    return buildTryOnCacheKey(garmentSourceHash, personPhotoHash, apiVersion);
  }

  /* ---------------------------------------------------------------------------------------------
   * Health (§3.2 requirement 10, E-14)
   * ------------------------------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------------------------------
   * Retention (§3.2 requirement 4, §3.5 step 4)
   * ------------------------------------------------------------------------------------------ */

  /**
   * §3.2 requirement 4 — removes `.tmp` entries older than `olderThan`, up to `limit`.
   *
   * `0` when the active driver has no temporary directory (a bucket driver writes
   * straight to the bucket, so an aborted upload leaves nothing behind to sweep). The
   * caller cannot tell "nothing to sweep" from "nothing sweepable", and does not need to:
   * both mean there is no orphaned byte here to account for.
   */
  async sweepTemporaryFiles(olderThan: Date, limit: number): Promise<number> {
    if (this.driver.sweepTemporaryFiles === undefined) {
      return 0;
    }
    return this.driver.sweepTemporaryFiles(olderThan, limit);
  }

  async freeSpace(): Promise<FreeSpaceReport> {
    const freeBytes = this.driver.freeSpaceBytes
      ? await this.driver.freeSpaceBytes().catch(() => null)
      : null;
    return {
      freeBytes,
      minFreeBytes: this.config.minFreeBytes,
      ok: freeBytes === null || freeBytes >= this.config.minFreeBytes,
    };
  }

  /* ---------------------------------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------------------------------ */

  private assertAllowedUploadMimeType(contentType: string): void {
    if (!isAllowedUploadMimeType(contentType)) {
      throw imageFormatUnsupported({ declared: normaliseMimeType(contentType) });
    }
  }

  private effectiveMaxBytes(requested?: number): number {
    const ceiling = this.config.maxUploadBytes;
    if (requested === undefined || requested <= 0) {
      return ceiling;
    }
    return Math.min(requested, ceiling);
  }

  /**
   * Cuts a stream off the moment it exceeds `maxBytes`, so an attacker cannot fill the volume by
   * lying about `byteSize` in the ticket request.
   */
  private enforceMaxBytes(body: Buffer | Readable, maxBytes: number): Buffer | Readable {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    if (Buffer.isBuffer(body)) {
      if (body.byteLength > maxBytes) {
        throw imageTooLarge(maxMb);
      }
      return body;
    }
    return Readable.from(
      (async function* limit(): AsyncGenerator<Buffer> {
        let total = 0;
        for await (const chunk of body) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          total += buffer.byteLength;
          if (total > maxBytes) {
            throw imageTooLarge(maxMb);
          }
          yield buffer;
        }
      })(),
    );
  }
}
