/**
 * ARCHITECTURE.md §3.2 — the local-disk driver.
 *
 * Requirement by requirement:
 *
 * 1. root resolved once at init, absolute, outside the repository — `storage.config.ts`;
 * 2. every operation goes through `assertInsideRoot()`, the single private method below. There is no
 *    code path to disk that skips it;
 * 3. keys are validated against the §3.2 pattern before `assertInsideRoot`;
 * 4. writes are atomic — `<root>/.tmp/<uuid>`, `fsync`, then `rename`;
 * 5. parent directories are created with `mkdir -p` semantics, under the root only;
 * 6. `delete` is idempotent — `ENOENT` returns `false`;
 * 7. every write computes sha256 while streaming and returns it as `etag`;
 * 8. nothing here serves the root — the only read path is `GET /api/v1/files/:token`;
 * 9. content type is validated against the magic bytes, not the client header;
 * 10. `freeSpaceBytes()` backs the `/health/ready` check.
 *
 * `<root>/.meta/<key>.json` holds the content type and the sha256 of each object so `head()` and
 * `list()` are cheap. Both `.tmp` and `.meta` start with a dot, which the key pattern forbids, so no
 * caller-supplied key can ever address them. If a sidecar is missing the driver recomputes from the
 * bytes, so the store stays correct even if one is lost.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import {
  fileNotFound,
  imageFormatUnsupported,
  storagePathRejected,
  storageWriteFailed,
} from '../exceptions/storage.exception';
import { SignedUrlService } from '../signed-url.service';
import {
  assertValidStorageKey,
  assertValidStoragePrefix,
  META_DIR_NAME,
  mimeTypeForKey,
  mimeTypesMatch,
  sniffMimeType,
  TEMP_DIR_NAME,
  tempFileName,
} from '../storage-key.builder';
import { STORAGE_CONFIG, type StorageConfig } from '../storage.config';

import type {
  CreateUploadTicketOptions,
  PutOptions,
  StorageDriver,
  StoredObject,
  UploadTicket,
} from './storage-driver.interface';
import type { Readable } from 'node:stream';

/** Enough bytes for every signature in `sniffMimeType`, including the SVG text probe. */
const SNIFF_BYTES = 256;

const DEFAULT_LIST_LIMIT = 1000;

interface ObjectMetadata {
  contentType: string;
  etag: string;
  cacheControl?: string;
}

function isErrno(error: unknown, ...codes: readonly string[]): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && codes.includes(code);
}

/** `AppException`s from `@library/common` carry an `errorCode`; anything else is a raw fs failure. */
function isTypedAppError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { errorCode?: unknown }).errorCode === 'string'
  );
}

async function* toChunks(body: Buffer | Readable): AsyncGenerator<Buffer> {
  if (Buffer.isBuffer(body)) {
    yield body;
    return;
  }
  for await (const chunk of body) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
  }
}

async function hashFile(full: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(full)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

@Injectable()
export class LocalDiskDriver implements StorageDriver, OnModuleInit {
  readonly name = 'local-disk' as const;

  private readonly logger = new Logger(LocalDiskDriver.name);
  private readonly root: string;
  private readonly tempDir: string;
  private readonly metaDir: string;

  constructor(
    @Inject(STORAGE_CONFIG) config: StorageConfig,
    private readonly signedUrls: SignedUrlService,
  ) {
    // Requirement 1 — already resolved, absolute and asserted outside the repository at load time.
    this.root = config.root;
    this.tempDir = join(this.root, TEMP_DIR_NAME);
    this.metaDir = join(this.root, META_DIR_NAME);
  }

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  /** Requirement 4 — `.tmp` is created at init and swept of stale files by the retention cron. */
  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(this.tempDir, { recursive: true });
    await mkdir(this.metaDir, { recursive: true });
    this.logger.log(`Local storage ready at ${this.root}`);
  }

  /* ---------------------------------------------------------------------------------------------
   * Requirement 2 — the one and only path check
   * ------------------------------------------------------------------------------------------ */

  /**
   * Resolves `relativePath` against the root and proves the result did not escape it.
   *
   * `path.resolve` is what makes this total on Windows as well as POSIX: an absolute path, a drive
   * letter or a UNC share simply replaces the root and then fails the `startsWith` test. Keys are
   * validated first, so those inputs never get this far — this is the backstop that still holds if
   * a future caller forgets.
   */
  private assertInsideRoot(relativePath: string): string {
    const full = resolve(this.root, relativePath);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      // §2.4: logged at `warn` with the raw key. It never reaches the client.
      this.logger.warn(`Rejected storage path outside root: ${JSON.stringify(relativePath)}`);
      throw storagePathRejected();
    }
    return full;
  }

  private pathForKey(key: string): string {
    assertValidStorageKey(key);
    return this.assertInsideRoot(key);
  }

  private pathForPrefix(prefix: string): string {
    assertValidStoragePrefix(prefix);
    return this.assertInsideRoot(prefix);
  }

  private metaPathForKey(key: string): string {
    return this.assertInsideRoot(join(META_DIR_NAME, `${key}.json`));
  }

  /* ---------------------------------------------------------------------------------------------
   * Writes
   * ------------------------------------------------------------------------------------------ */

  async put(key: string, body: Buffer | Readable, options: PutOptions): Promise<StoredObject> {
    const full = this.pathForKey(key);

    if ((options.failIfExists ?? true) && (await this.exists(key))) {
      throw storageWriteFailed(new Error('Object already exists and failIfExists was set.'));
    }

    const temporaryPath = join(this.tempDir, tempFileName());
    const hash = createHash('sha256');
    let byteSize = 0;
    let head = Buffer.alloc(0);

    try {
      await mkdir(this.tempDir, { recursive: true });
      const handle = await open(temporaryPath, 'wx');
      try {
        for await (const chunk of toChunks(body)) {
          if (head.length < SNIFF_BYTES) {
            head = Buffer.concat([head, chunk.subarray(0, SNIFF_BYTES - head.length)]);
          }
          hash.update(chunk);
          byteSize += chunk.length;
          await handle.write(chunk);
        }
        // Requirement 4 — durable before the rename, so a crash can never publish a partial object.
        await handle.sync();
      } finally {
        await handle.close();
      }

      // Requirement 9 — magic bytes, not the client-supplied header.
      this.assertContentTypeMatchesBytes(head, options.contentType);

      // Requirement 5 — parent directories on demand, under the root only.
      await mkdir(dirname(full), { recursive: true });
      await rename(temporaryPath, full);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw isTypedAppError(error) ? error : storageWriteFailed(error);
    }

    const metadata: ObjectMetadata = {
      contentType: options.contentType,
      // Requirement 7 — sha256 computed while streaming, persisted by callers as the `hash` column.
      etag: hash.digest('hex'),
      ...(options.cacheControl === undefined ? {} : { cacheControl: options.cacheControl }),
    };
    await this.writeMetadata(key, metadata);

    return {
      key,
      byteSize,
      contentType: metadata.contentType,
      etag: metadata.etag,
      // `stats.mtime` is constructed inside Node's own realm, so `instanceof Date`
      // fails for a caller running in a sandboxed realm (Jest, vm contexts).
      // Rebuild it from the epoch millis so the Date belongs to our realm.
      lastModified: new Date((await stat(full)).mtimeMs),
    };
  }

  /**
   * §3.7 — on a content-hash cache hit the render is copied into the requesting user's own
   * namespace. Streaming through `put` keeps the copy atomic and re-derives the sha256, so a
   * corrupted source can never be propagated with a stale etag.
   */
  async copy(sourceKey: string, destinationKey: string): Promise<StoredObject> {
    const sourcePath = this.pathForKey(sourceKey);
    const source = await this.head(sourceKey);
    if (source === null) {
      throw fileNotFound();
    }
    return this.put(destinationKey, createReadStream(sourcePath), {
      contentType: source.contentType,
      failIfExists: true,
    });
  }

  /* ---------------------------------------------------------------------------------------------
   * Reads
   * ------------------------------------------------------------------------------------------ */

  async get(key: string): Promise<Readable> {
    const full = this.pathForKey(key);
    if (!(await this.exists(key))) {
      throw fileNotFound();
    }
    return createReadStream(full);
  }

  async head(key: string): Promise<StoredObject | null> {
    const full = this.pathForKey(key);
    let stats;
    try {
      stats = await stat(full);
    } catch (error) {
      if (isErrno(error, 'ENOENT', 'ENOTDIR')) {
        return null;
      }
      throw error;
    }
    if (!stats.isFile()) {
      return null;
    }
    const metadata = await this.readMetadata(key, full);
    return {
      key,
      byteSize: stats.size,
      contentType: metadata.contentType,
      etag: metadata.etag,
      // See `put`: rebuild from epoch millis so the Date is realm-local.
      lastModified: new Date(stats.mtimeMs),
    };
  }

  async exists(key: string): Promise<boolean> {
    const full = this.pathForKey(key);
    try {
      return (await stat(full)).isFile();
    } catch (error) {
      if (isErrno(error, 'ENOENT', 'ENOTDIR')) {
        return false;
      }
      throw error;
    }
  }

  async list(prefix: string, limit: number = DEFAULT_LIST_LIMIT): Promise<StoredObject[]> {
    const directory = this.pathForPrefix(prefix);
    const keys = await this.collectKeys(directory, limit);
    const objects: StoredObject[] = [];
    for (const key of keys) {
      const object = await this.head(key);
      if (object !== null) {
        objects.push(object);
      }
    }
    return objects;
  }

  /* ---------------------------------------------------------------------------------------------
   * Deletes
   * ------------------------------------------------------------------------------------------ */

  /** Requirement 6 — idempotent. `ENOENT` returns `false`, never throws. */
  async delete(key: string): Promise<boolean> {
    const full = this.pathForKey(key);
    let removed = true;
    try {
      await unlink(full);
    } catch (error) {
      if (!isErrno(error, 'ENOENT', 'ENOTDIR')) {
        throw error;
      }
      removed = false;
    }
    await unlink(this.metaPathForKey(key)).catch(() => undefined);
    await this.pruneEmptyDirectories(dirname(full));
    return removed;
  }

  /**
   * Removes everything under `prefix` and returns the count, which the caller writes to
   * `deletion_log.itemsDeleted` (§3.3, §9.3 verifiable deletion log).
   */
  async deletePrefix(prefix: string): Promise<number> {
    const directory = this.pathForPrefix(prefix);
    const count = (await this.collectKeys(directory, Number.POSITIVE_INFINITY)).length;
    await rm(directory, { recursive: true, force: true });
    await rm(this.assertInsideRoot(join(META_DIR_NAME, prefix)), { recursive: true, force: true });
    await this.pruneEmptyDirectories(dirname(directory));
    return count;
  }

  /* ---------------------------------------------------------------------------------------------
   * Upload tickets (§3.5)
   * ------------------------------------------------------------------------------------------ */

  /**
   * The local driver has no independent storage host, so the ticket points back at the API and
   * `isDirect` is `false`. A future S3 driver returns a genuine presigned bucket URL with
   * `isDirect: true` from this same method, and no caller changes.
   */
  createUploadTicket(key: string, options: CreateUploadTicketOptions): Promise<UploadTicket> {
    assertValidStorageKey(key);
    const { token, payload } = this.signedUrls.issueUploadTicket(key, {
      contentType: options.contentType,
      maxBytes: options.maxBytes,
      ttlSeconds: options.ttlSeconds,
      subject: options.subject,
    });
    return Promise.resolve({
      uploadUrl: this.signedUrls.buildUploadUrl(),
      ticket: token,
      key,
      fields: {},
      expiresAt: new Date(payload.exp * 1000),
      isDirect: false,
    });
  }

  /* ---------------------------------------------------------------------------------------------
   * Health (requirement 10)
   * ------------------------------------------------------------------------------------------ */

  async freeSpaceBytes(): Promise<number> {
    const stats = await statfs(this.root);
    return Number(stats.bavail) * Number(stats.bsize);
  }

  async sweepTemporaryFiles(olderThan: Date, limit: number): Promise<number> {
    if (limit <= 0) {
      return 0;
    }

    let entries;
    try {
      entries = await readdir(this.tempDir, { withFileTypes: true });
    } catch (error) {
      if (isErrno(error, 'ENOENT', 'ENOTDIR')) {
        return 0;
      }
      throw error;
    }

    const cutoff = olderThan.getTime();
    let removed = 0;

    for (const entry of entries) {
      if (removed >= limit) {
        break;
      }
      if (!entry.isFile()) {
        continue;
      }
      const full = this.assertInsideRoot(join(TEMP_DIR_NAME, entry.name));

      try {
        const stats = await stat(full);
        if (stats.mtimeMs >= cutoff) {
          continue;
        }
        await unlink(full);
        removed += 1;
      } catch (error) {
        if (isErrno(error, 'ENOENT', 'ENOTDIR')) {
          continue;
        }
        this.logger.warn(
          `A stale temporary file could not be removed and will be retried on the next sweep: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (removed > 0) {
      this.logger.log(`Swept ${removed} stale temporary file(s) from .tmp (§3.2 requirement 4).`);
    }
    return removed;
  }

  /* ---------------------------------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------------------------------ */

  private assertContentTypeMatchesBytes(head: Buffer, declaredContentType: string): void {
    const detected = sniffMimeType(head);
    if (detected === null || !mimeTypesMatch(detected, declaredContentType)) {
      throw imageFormatUnsupported({ declared: declaredContentType, detected });
    }
  }

  private async writeMetadata(key: string, metadata: ObjectMetadata): Promise<void> {
    const metaPath = this.metaPathForKey(key);
    const temporaryPath = join(this.tempDir, tempFileName());
    await mkdir(dirname(metaPath), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(metadata), 'utf8');
    await rename(temporaryPath, metaPath);
  }

  /** Falls back to the extension and a recomputed sha256 when the sidecar is missing. */
  private async readMetadata(key: string, full: string): Promise<ObjectMetadata> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.metaPathForKey(key), 'utf8'));
      if (
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as ObjectMetadata).contentType === 'string' &&
        typeof (raw as ObjectMetadata).etag === 'string'
      ) {
        return raw as ObjectMetadata;
      }
    } catch {
      // Falls through to recomputation.
    }
    return { contentType: mimeTypeForKey(key), etag: await hashFile(full) };
  }

  /** Depth-first walk that skips dot-directories, so `.tmp` and `.meta` are never listed. */
  private async collectKeys(directory: string, limit: number): Promise<string[]> {
    const keys: string[] = [];

    const walk = async (current: string): Promise<void> => {
      if (keys.length >= limit) {
        return;
      }
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (error) {
        if (isErrno(error, 'ENOENT', 'ENOTDIR')) {
          return;
        }
        throw error;
      }
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        if (keys.length >= limit || entry.name.startsWith('.')) {
          continue;
        }
        const child = join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(child);
        } else if (entry.isFile()) {
          keys.push(relative(this.root, child).split(sep).join(posix.sep));
        }
      }
    };

    await walk(directory);
    return keys;
  }

  /** Keeps the tree tidy after deletes. Stops at the root and gives up as soon as one is not empty. */
  private async pruneEmptyDirectories(startDirectory: string): Promise<void> {
    let current = resolve(startDirectory);
    while (current !== this.root && current.startsWith(this.root + sep)) {
      try {
        await rmdir(current);
      } catch {
        return;
      }
      current = dirname(current);
    }
  }
}
