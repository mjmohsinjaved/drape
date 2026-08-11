/**
 * ARCHITECTURE.md §3.1 — the seam between "local disk in V1" and "object storage later".
 *
 * No code outside `libs/storage` ever touches `fs`, `path.join` on a storage key, or a bucket SDK.
 * Adding S3 means adding `s3.driver.ts` and one line in `storage.module.ts` — no call site changes.
 */
import type { Readable } from 'node:stream';

export interface StoredObject {
  key: string;
  byteSize: number;
  contentType: string;
  /** sha256 of the bytes, hex — also the content hash used by the cache (§3.7). */
  etag: string;
  lastModified: Date;
}

export interface PutOptions {
  contentType: string;
  /** Fails with STORAGE_WRITE_FAILED instead of overwriting when true. Default true. */
  failIfExists?: boolean;
  cacheControl?: string;
}

export interface UploadTicket {
  uploadUrl: string;

  ticket: string;
  /** The key the object will occupy once redeemed. */
  key: string;
  /** Extra fields the client must send. Empty for the local driver; S3 POST policy fields later. */
  fields: Record<string, string>;
  expiresAt: Date;
  /** true when uploadUrl points at an origin the API does not control (S3). */
  isDirect: boolean;
}

export interface CreateUploadTicketOptions {
  contentType: string;
  maxBytes: number;
  ttlSeconds: number;

  subject: string;
}

export interface StorageDriver {
  readonly name: 'local-disk' | 's3';

  put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  head(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  /** Idempotent: false when already absent. */
  delete(key: string): Promise<boolean>;
  /** Returns objects removed. */
  deletePrefix(prefix: string): Promise<number>;
  copy(sourceKey: string, destinationKey: string): Promise<StoredObject>;
  list(prefix: string, limit?: number): Promise<StoredObject[]>;

  createUploadTicket(key: string, options: CreateUploadTicketOptions): Promise<UploadTicket>;

  init?(): Promise<void>;

  freeSpaceBytes?(): Promise<number>;

  sweepTemporaryFiles?(olderThan: Date, limit: number): Promise<number>;
}
