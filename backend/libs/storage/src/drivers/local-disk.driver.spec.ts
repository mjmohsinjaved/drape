/**
 * ARCHITECTURE.md §3.2 — the local-disk driver.
 *
 * Every test runs against a throwaway directory under `os.tmpdir()`. The real `STORAGE_ROOT` is
 * never read and never written by this suite.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';

import { SignedUrlService } from '../signed-url.service';
import { StorageKeys, StoragePrefixes } from '../storage-key.builder';

import { LocalDiskDriver } from './local-disk.driver';

import type { StorageConfig } from '../storage.config';

const USER_ID = '11111111-2222-4333-8444-555555555555';
const GARMENT_ID = '0f1e2d3c-4b5a-4988-9776-a5b4c3d2e1f0';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBytes = (payload: string): Buffer =>
  Buffer.concat([PNG_SIGNATURE, Buffer.from(payload, 'utf8')]);

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')]);

function configFor(root: string): StorageConfig {
  return {
    driver: 'local',
    root,
    urlSecret: 'a'.repeat(64),
    apiBaseUrl: 'http://localhost:4000',
    photoUrlTtlSeconds: 300,
    renderUrlTtlSeconds: 900,
    publicUrlTtlSeconds: 3600,
    uploadTicketTtlSeconds: 900,
    maxUploadBytes: 25 * 1024 * 1024,
    minFreeBytes: 0,
  };
}

async function errorCodeOfAsync(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const code = (error as { errorCode?: unknown }).errorCode;
    return typeof code === 'string' ? code : `<${String(error)}>`;
  }
  return '<no error thrown>';
}

function errorCodeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    const code = (error as { errorCode?: unknown }).errorCode;
    return typeof code === 'string' ? code : `<${String(error)}>`;
  }
  return '<no error thrown>';
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

describe('LocalDiskDriver', () => {
  let root: string;
  let driver: LocalDiskDriver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'drape-storage-test-'));
    driver = new LocalDiskDriver(configFor(root), new SignedUrlService(configFor(root)));
    await driver.init();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('init', () => {
    it('creates the root, the .tmp staging directory and the .meta sidecar directory', async () => {
      expect((await stat(root)).isDirectory()).toBe(true);
      expect((await stat(join(root, '.tmp'))).isDirectory()).toBe(true);
      expect((await stat(join(root, '.meta'))).isDirectory()).toBe(true);
    });

    it('is idempotent', async () => {
      await expect(driver.init()).resolves.toBeUndefined();
    });
  });

  describe('put and get (requirements 4, 5, 7)', () => {
    it('round trips the bytes and returns the sha256 as the etag', async () => {
      const key = StorageKeys.render(USER_ID);
      const body = pngBytes('render-bytes');

      const stored = await driver.put(key, body, { contentType: 'image/png' });

      expect(stored.key).toBe(key);
      expect(stored.byteSize).toBe(body.byteLength);
      expect(stored.contentType).toBe('image/png');
      expect(stored.etag).toBe(createHash('sha256').update(body).digest('hex'));
      expect(stored.lastModified).toBeInstanceOf(Date);
      expect(await collect(await driver.get(key))).toEqual(body);
    });

    it('accepts a stream and hashes it as it goes, never buffering the whole file', async () => {
      const key = StorageKeys.personPhoto(USER_ID, 'jpg');
      const chunks = [JPEG, Buffer.from('-tail-1'), Buffer.from('-tail-2')];
      const expected = Buffer.concat(chunks);

      const stored = await driver.put(key, Readable.from(chunks), { contentType: 'image/jpeg' });

      expect(stored.byteSize).toBe(expected.byteLength);
      expect(stored.etag).toBe(createHash('sha256').update(expected).digest('hex'));
      expect(await collect(await driver.get(key))).toEqual(expected);
    });

    it('creates parent directories on demand, under the root only', async () => {
      const key = StorageKeys.garmentImage(GARMENT_ID, 'png');
      await driver.put(key, pngBytes('x'), { contentType: 'image/png' });
      expect((await stat(join(root, 'garments', GARMENT_ID))).isDirectory()).toBe(true);
    });

    it('leaves nothing behind in .tmp — the write is staged then renamed', async () => {
      await driver.put(StorageKeys.render(USER_ID), pngBytes('x'), { contentType: 'image/png' });
      expect(await readdir(join(root, '.tmp'))).toEqual([]);
    });

    it('refuses to overwrite by default', async () => {
      const key = StorageKeys.render(USER_ID);
      await driver.put(key, pngBytes('first'), { contentType: 'image/png' });

      expect(
        await errorCodeOfAsync(() =>
          driver.put(key, pngBytes('second'), { contentType: 'image/png' }),
        ),
      ).toBe('STORAGE_WRITE_FAILED');
      expect(await collect(await driver.get(key))).toEqual(pngBytes('first'));
    });

    it('overwrites when failIfExists is false', async () => {
      const key = StorageKeys.render(USER_ID);
      await driver.put(key, pngBytes('first'), { contentType: 'image/png' });
      await driver.put(key, pngBytes('second'), { contentType: 'image/png', failIfExists: false });
      expect(await collect(await driver.get(key))).toEqual(pngBytes('second'));
    });

    it('validates the magic bytes, not the client-supplied header (requirement 9)', async () => {
      const key = StorageKeys.garmentImage(GARMENT_ID, 'png');

      expect(
        await errorCodeOfAsync(() =>
          driver.put(key, Buffer.from('GIF89a-not-really-a-png'), { contentType: 'image/png' }),
        ),
      ).toBe('IMAGE_FORMAT_UNSUPPORTED');

      expect(await driver.exists(key)).toBe(false);
      expect(await readdir(join(root, '.tmp'))).toEqual([]);
    });

    it('rejects a real image whose declared type does not match its bytes', async () => {
      expect(
        await errorCodeOfAsync(() =>
          driver.put(StorageKeys.garmentImage(GARMENT_ID, 'png'), JPEG, {
            contentType: 'image/png',
          }),
        ),
      ).toBe('IMAGE_FORMAT_UNSUPPORTED');
    });
  });

  describe('head, exists and stat', () => {
    it('reports size, content type and hash for a stored object', async () => {
      const key = StorageKeys.render(USER_ID);
      const body = pngBytes('head-me');
      await driver.put(key, body, { contentType: 'image/png' });

      const object = await driver.head(key);

      expect(object).not.toBeNull();
      expect(object?.byteSize).toBe(body.byteLength);
      expect(object?.contentType).toBe('image/png');
      expect(object?.etag).toBe(createHash('sha256').update(body).digest('hex'));
    });

    it('returns null for a missing object and false from exists', async () => {
      const key = StorageKeys.render(USER_ID);
      expect(await driver.head(key)).toBeNull();
      expect(await driver.exists(key)).toBe(false);
    });

    it('recomputes the hash when the sidecar is lost', async () => {
      const key = StorageKeys.render(USER_ID);
      const body = pngBytes('sidecar-gone');
      await driver.put(key, body, { contentType: 'image/png' });
      await rm(join(root, '.meta'), { recursive: true, force: true });

      const object = await driver.head(key);

      expect(object?.etag).toBe(createHash('sha256').update(body).digest('hex'));
      expect(object?.contentType).toBe('image/png');
    });

    it('raises FILE_NOT_FOUND when reading a missing object', async () => {
      expect(await errorCodeOfAsync(() => driver.get(StorageKeys.render(USER_ID)))).toBe(
        'FILE_NOT_FOUND',
      );
    });
  });

  describe('delete (requirement 6)', () => {
    it('removes the object and its sidecar, and is idempotent', async () => {
      const key = StorageKeys.render(USER_ID);
      await driver.put(key, pngBytes('bye'), { contentType: 'image/png' });

      expect(await driver.delete(key)).toBe(true);
      expect(await driver.exists(key)).toBe(false);
      expect(await driver.delete(key)).toBe(false);
    });

    it('never throws for an object that was never there', async () => {
      await expect(driver.delete(StorageKeys.personPhoto(USER_ID, 'jpg'))).resolves.toBe(false);
    });
  });

  describe('deletePrefix (§3.3, §9.3 deletion log)', () => {
    it('removes every object under the prefix and returns the count', async () => {
      await driver.put(StorageKeys.render(USER_ID), pngBytes('a'), { contentType: 'image/png' });
      await driver.put(StorageKeys.render(USER_ID), pngBytes('b'), { contentType: 'image/png' });
      await driver.put(StorageKeys.render(USER_ID), pngBytes('c'), { contentType: 'image/png' });
      const survivor = StorageKeys.garmentImage(GARMENT_ID, 'png');
      await driver.put(survivor, pngBytes('keep'), { contentType: 'image/png' });

      const removed = await driver.deletePrefix(StoragePrefixes.rendersOfUser(USER_ID));

      expect(removed).toBe(3);
      expect(await driver.exists(survivor)).toBe(true);
      expect(await driver.list(StoragePrefixes.rendersOfUser(USER_ID))).toEqual([]);
    });

    it('returns zero for a prefix that holds nothing', async () => {
      expect(await driver.deletePrefix(StoragePrefixes.personPhotosOfUser(USER_ID))).toBe(0);
    });
  });

  describe('copy (§3.7 cache hit)', () => {
    it('copies into another namespace and re-derives the hash', async () => {
      const source = StorageKeys.render(USER_ID);
      const destination = StorageKeys.render('99999999-8888-4777-8666-555555555555');
      const body = pngBytes('cached-render');
      await driver.put(source, body, { contentType: 'image/png' });

      const copied = await driver.copy(source, destination);

      expect(copied.key).toBe(destination);
      expect(copied.etag).toBe(createHash('sha256').update(body).digest('hex'));
      expect(await collect(await driver.get(destination))).toEqual(body);
      expect(await driver.exists(source)).toBe(true);
    });

    it('fails when the source is absent', async () => {
      expect(
        await errorCodeOfAsync(() =>
          driver.copy(StorageKeys.render(USER_ID), StorageKeys.render(USER_ID)),
        ),
      ).toBe('FILE_NOT_FOUND');
    });
  });

  describe('list', () => {
    it('lists objects under a prefix and never exposes .tmp or .meta', async () => {
      const keys = [
        StorageKeys.garmentImage(GARMENT_ID, 'png'),
        StorageKeys.garmentImage(GARMENT_ID, 'png'),
      ];
      for (const key of keys) {
        await driver.put(key, pngBytes(key), { contentType: 'image/png' });
      }
      await writeFile(join(root, '.tmp', 'orphan'), 'stale');

      const listed = await driver.list(StoragePrefixes.garment(GARMENT_ID));

      expect(listed.map((object) => object.key).sort()).toEqual([...keys].sort());
      expect(await driver.list('brand/')).toEqual([]);
    });

    it('honours the limit', async () => {
      for (let index = 0; index < 4; index += 1) {
        await driver.put(StorageKeys.garmentImage(GARMENT_ID, 'png'), pngBytes(`${index}`), {
          contentType: 'image/png',
        });
      }
      expect(await driver.list(StoragePrefixes.garment(GARMENT_ID), 2)).toHaveLength(2);
    });
  });

  describe('path traversal (requirements 2 and 3)', () => {
    const hostileKeys: ReadonlyArray<readonly [string, string]> = [
      ['parent traversal', '../evil.png'],
      ['nested traversal', 'renders/../../evil.png'],
      ['posix absolute', '/etc/passwd.png'],
      ['windows backslash traversal', '..\\evil.png'],
      ['windows nested backslash', 'renders\\..\\..\\evil.png'],
      ['windows drive letter', 'C:\\Windows\\system32\\evil.png'],
      ['windows drive relative', 'C:evil.png'],
      ['unc share', '\\\\attacker\\share\\evil.png'],
      ['extended length unc', '\\\\?\\C:\\evil.png'],
      ['nul byte truncation', 'renders/evil.png\u0000.txt'],
      ['dot staging directory', '.tmp/evil.png'],
      ['sidecar directory', '.meta/renders/evil.png.json'],
    ];

    it('rejects every vector on put, before touching the filesystem', async () => {
      for (const [label, key] of hostileKeys) {
        expect([
          label,
          await errorCodeOfAsync(() =>
            driver.put(key, pngBytes('x'), { contentType: 'image/png' }),
          ),
        ]).toEqual([label, 'STORAGE_PATH_REJECTED']);
      }
    });

    it('rejects every vector on get', async () => {
      for (const [label, key] of hostileKeys) {
        expect([label, await errorCodeOfAsync(() => driver.get(key))]).toEqual([
          label,
          'STORAGE_PATH_REJECTED',
        ]);
      }
    });

    it('rejects every vector on head, exists and delete', async () => {
      for (const [label, key] of hostileKeys) {
        expect([label, await errorCodeOfAsync(() => driver.head(key))]).toEqual([
          label,
          'STORAGE_PATH_REJECTED',
        ]);
        expect([label, await errorCodeOfAsync(() => driver.exists(key))]).toEqual([
          label,
          'STORAGE_PATH_REJECTED',
        ]);
        expect([label, await errorCodeOfAsync(() => driver.delete(key))]).toEqual([
          label,
          'STORAGE_PATH_REJECTED',
        ]);
      }
    });

    it('rejects a hostile prefix on deletePrefix and list', async () => {
      for (const prefix of [
        '../',
        'renders/../../',
        '/etc/',
        '..\\',
        'C:\\',
        '\\\\host\\share\\',
      ]) {
        expect(await errorCodeOfAsync(() => driver.deletePrefix(prefix))).toBe(
          'STORAGE_PATH_REJECTED',
        );
        expect(await errorCodeOfAsync(() => driver.list(prefix))).toBe('STORAGE_PATH_REJECTED');
      }
    });

    it('rejects a hostile destination on copy', async () => {
      const source = StorageKeys.render(USER_ID);
      await driver.put(source, pngBytes('x'), { contentType: 'image/png' });
      expect(await errorCodeOfAsync(() => driver.copy(source, '../escaped.png'))).toBe(
        'STORAGE_PATH_REJECTED',
      );
    });

    it('writes nothing outside the root even when several vectors are tried in sequence', async () => {
      for (const [, key] of hostileKeys) {
        await errorCodeOfAsync(() => driver.put(key, pngBytes('x'), { contentType: 'image/png' }));
      }
      expect((await readdir(root)).sort()).toEqual(['.meta', '.tmp']);
    });

    describe('assertInsideRoot backstop', () => {
      const backstop = (instance: LocalDiskDriver, path: string): string =>
        errorCodeOf(() =>
          (instance as unknown as { assertInsideRoot(value: string): string }).assertInsideRoot(
            path,
          ),
        );

      it('rejects paths that escape the root on every platform', () => {
        expect(backstop(driver, '..')).toBe('STORAGE_PATH_REJECTED');
        expect(backstop(driver, '../evil.png')).toBe('STORAGE_PATH_REJECTED');
        expect(backstop(driver, 'a/../../evil.png')).toBe('STORAGE_PATH_REJECTED');
        expect(backstop(driver, '/etc/passwd')).toBe('STORAGE_PATH_REJECTED');
      });

      it('accepts a legitimate relative key', () => {
        expect(backstop(driver, 'renders/a/b.png')).toBe('<no error thrown>');
      });

      // Drive letters and UNC shares only *resolve* as absolute on Windows; on POSIX they are
      // ordinary filenames and are stopped one layer earlier, by key validation.
      const onWindows = process.platform === 'win32' ? it : it.skip;

      onWindows('rejects a drive letter, a UNC share and a backslash traversal', () => {
        expect(backstop(driver, 'C:\\Windows\\system32\\config')).toBe('STORAGE_PATH_REJECTED');
        expect(backstop(driver, '\\\\attacker\\share\\payload.png')).toBe('STORAGE_PATH_REJECTED');
        expect(backstop(driver, '\\\\?\\C:\\payload.png')).toBe('STORAGE_PATH_REJECTED');
        expect(backstop(driver, '..\\evil.png')).toBe('STORAGE_PATH_REJECTED');
        expect(backstop(driver, 'renders\\..\\..\\evil.png')).toBe('STORAGE_PATH_REJECTED');
      });

      it('rejects a sibling directory whose name merely starts with the root name', () => {
        // `startsWith(root)` alone would let this through; the check appends the separator.
        expect(backstop(driver, `../${basename(root)}-sibling/evil.png`)).toBe(
          'STORAGE_PATH_REJECTED',
        );
      });
    });
  });

  describe('upload tickets (§3.5)', () => {
    it('returns an API-hosted, non-direct ticket for the local driver', async () => {
      const key = StorageKeys.personPhoto(USER_ID, 'jpg');

      const ticket = await driver.createUploadTicket(key, {
        contentType: 'image/jpeg',
        maxBytes: 5_000_000,
        ttlSeconds: 900,
        subject: USER_ID,
      });

      expect(ticket.key).toBe(key);
      expect(ticket.isDirect).toBe(false);
      expect(ticket.fields).toEqual({});
      expect(ticket.uploadUrl.startsWith('http://localhost:4000/api/v1/files/upload/')).toBe(true);
      expect(ticket.uploadUrl).not.toContain(key);
      expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects a hostile key before signing anything', async () => {
      expect(
        await errorCodeOfAsync(() =>
          driver.createUploadTicket('../evil.png', {
            contentType: 'image/jpeg',
            maxBytes: 1,
            ttlSeconds: 900,
            subject: USER_ID,
          }),
        ),
      ).toBe('STORAGE_PATH_REJECTED');
    });
  });

  describe('free space (requirement 10)', () => {
    it('reports a positive number of bytes for the volume holding the root', async () => {
      expect(await driver.freeSpaceBytes()).toBeGreaterThan(0);
    });
  });

  /**
   * ARCHITECTURE §3.2 requirement 4 — "`.tmp` swept of files older than 6 hours by the
   * retention cron."
   *
   * `init()`'s own comment claimed this happened; nothing implemented it. A `.tmp` file is
   * a write that started and never renamed into place — an aborted upload, a process
   * killed mid-stream — so it may be most of a photograph, and it is addressable by no
   * key, which means no row names it and no other sweep can see it. This is the only way
   * one is ever removed.
   */
  describe('sweeping .tmp (requirement 4)', () => {
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

    async function writeTemporaryFile(name: string, ageMs: number): Promise<string> {
      const full = join(root, '.tmp', name);
      await writeFile(full, 'a partial photograph');
      const when = new Date(Date.now() - ageMs);
      await utimes(full, when, when);
      return full;
    }

    it('removes a stale temporary file', async () => {
      await writeTemporaryFile('aborted-upload', SIX_HOURS_MS + 60_000);

      const removed = await driver.sweepTemporaryFiles(new Date(Date.now() - SIX_HOURS_MS), 100);

      expect(removed).toBe(1);
      expect(await readdir(join(root, '.tmp'))).toEqual([]);
    });

    it('leaves a write that may still be in flight completely alone', async () => {
      await writeTemporaryFile('in-flight', 30_000);

      const removed = await driver.sweepTemporaryFiles(new Date(Date.now() - SIX_HOURS_MS), 100);

      expect(removed).toBe(0);
      expect(await readdir(join(root, '.tmp'))).toEqual(['in-flight']);
    });

    it('never touches a real object, however old', async () => {
      const key = StorageKeys.render(USER_ID);
      await driver.put(key, pngBytes('old render'), { contentType: 'image/png' });

      await driver.sweepTemporaryFiles(new Date(Date.now() + SIX_HOURS_MS), 100);

      expect(await driver.exists(key)).toBe(true);
    });

    it('honours the per-run bound', async () => {
      for (let index = 0; index < 5; index += 1) {
        await writeTemporaryFile(`stale-${index}`, SIX_HOURS_MS + 60_000);
      }

      const removed = await driver.sweepTemporaryFiles(new Date(Date.now() - SIX_HOURS_MS), 2);

      expect(removed).toBe(2);
      expect(await readdir(join(root, '.tmp'))).toHaveLength(3);
    });

    it('reports nothing when .tmp does not exist rather than throwing', async () => {
      await rm(join(root, '.tmp'), { recursive: true, force: true });

      await expect(driver.sweepTemporaryFiles(new Date(), 100)).resolves.toBe(0);
    });
  });
});
