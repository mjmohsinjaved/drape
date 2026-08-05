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
  /** Absolute URL the client PUTs the bytes to. */
  uploadUrl: string;
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
  /**
   * The userId the ticket is scoped to. **Required** — §3.5 has no ticket that anybody may
   * redeem, and the optional form here used to be defaulted to `''` by the local driver,
   * which is a ticket scoped to nobody rather than a ticket scoped to everybody only
   * because `verifyUploadTicket` happened to compare it against `undefined`.
   */
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

  /** Issues an upload target. Local driver returns an API URL; S3 returns a presigned URL. */
  createUploadTicket(key: string, options: CreateUploadTicketOptions): Promise<UploadTicket>;

  /**
   * Optional beyond §3.1: one-time preparation (creating the root, `.tmp` and `.meta`). A bucket
   * driver has nothing to prepare and may omit it.
   */
  init?(): Promise<void>;

  /**
   * Optional beyond §3.1: bytes available on the volume holding the root, for the
   * `STORAGE_MIN_FREE_MB` check in `/health/ready` (§3.2 requirement 10, E-14). A bucket driver has
   * no meaningful answer and may omit it.
   */
  freeSpaceBytes?(): Promise<number>;

  /**
   * Optional beyond §3.1 — §3.2 requirement 4: "`.tmp` swept of files older than 6 hours by
   * the retention cron".
   *
   * A `.tmp` file is a write that started and never renamed into place: an aborted upload,
   * a process killed mid-stream. It is not addressable by any key, so no row anywhere names
   * it and no other sweep can see it — and it may be most of a photograph. This is the only
   * way to remove one, and it is on the driver because `.tmp` is a local-disk implementation
   * detail. A bucket driver has no temporary directory and omits it.
   *
   * @returns the number of files removed.
   */
  sweepTemporaryFiles?(olderThan: Date, limit: number): Promise<number>;
}
