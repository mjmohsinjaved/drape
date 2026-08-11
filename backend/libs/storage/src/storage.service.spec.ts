/**
 * ARCHITECTURE.md §3.1 façade behaviour, §3.5 upload tickets.
 *
 * Runs against a throwaway directory under `os.tmpdir()`; the real `STORAGE_ROOT` is never touched.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { LocalDiskDriver } from './drivers/local-disk.driver';
import { SignedUrlService } from './signed-url.service';
import { StorageKeys } from './storage-key.builder';
import { StorageService } from './storage.service';

import type { StorageConfig } from './storage.config';

const OWNER = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const jpegBytes = (payload: string): Buffer =>
  Buffer.concat([JPEG_SIGNATURE, Buffer.from(payload, 'utf8')]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngBytes = (payload: string): Buffer =>
  Buffer.concat([PNG_SIGNATURE, Buffer.from(payload, 'utf8')]);

function configFor(root: string, maxUploadBytes: number): StorageConfig {
  return {
    driver: 'local',
    root,
    urlSecret: 'a'.repeat(64),
    apiBaseUrl: 'http://localhost:4000',
    photoUrlTtlSeconds: 300,
    renderUrlTtlSeconds: 900,
    publicUrlTtlSeconds: 3600,
    uploadTicketTtlSeconds: 900,
    maxUploadBytes,
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

describe('StorageService', () => {
  let root: string;
  let service: StorageService;
  let signedUrls: SignedUrlService;

  const MAX_BYTES = 1024;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'drape-storage-service-'));
    const config = configFor(root, MAX_BYTES);
    signedUrls = new SignedUrlService(config);
    const driver = new LocalDiskDriver(config, signedUrls);
    await driver.init();
    service = new StorageService(driver, config, signedUrls);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exposes the active driver so callers never branch on the environment', () => {
    expect(service.driverName).toBe('local-disk');
  });

  describe('put', () => {
    it('returns key, size, sha256 and mimeType', async () => {
      const key = StorageKeys.render(OWNER, 'png');
      const body = pngBytes('render');

      const result = await service.put(key, body, { contentType: 'image/png' });

      expect(result).toEqual({
        key,
        size: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
        mimeType: 'image/png',
      });
      expect(await service.getBuffer(key)).toEqual(body);
    });

    it('refuses a buffer over the ceiling', async () => {
      const oversize = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(MAX_BYTES)]);
      expect(
        await errorCodeOfAsync(() =>
          service.put(StorageKeys.render(OWNER, 'png'), oversize, { contentType: 'image/png' }),
        ),
      ).toBe('IMAGE_TOO_LARGE');
    });

    it('cuts a stream off mid-flight rather than discovering the overrun afterwards', async () => {
      const key = StorageKeys.render(OWNER, 'png');
      const chunks = [PNG_SIGNATURE, Buffer.alloc(600), Buffer.alloc(600)];

      expect(
        await errorCodeOfAsync(() =>
          service.put(key, Readable.from(chunks), { contentType: 'image/png' }),
        ),
      ).toBe('IMAGE_TOO_LARGE');
      expect(await service.exists(key)).toBe(false);
    });
  });

  describe('signed URLs', () => {
    it('issues a URL that verifies for its owner and not for anyone else', async () => {
      const key = StorageKeys.render(OWNER, 'png');
      await service.put(key, pngBytes('mine'), { contentType: 'image/png' });

      const url = service.signedUrl(key, OWNER);
      const token = url.slice(url.lastIndexOf('/') + 1);

      expect(service.verifyToken(token, OWNER).key).toBe(key);
      expect(await errorCodeOfAsync(async () => service.verifyToken(token, OTHER))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });

    it('never puts the storage key in the URL', () => {
      const key = StorageKeys.personPhoto(OWNER, 'jpg');
      expect(service.signedUrl(key, OWNER)).not.toContain(key);
    });
  });

  describe('upload tickets (§3.5)', () => {
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred from the service
    const ticketFor = async (key: string, contentType = 'image/jpeg', maxBytes?: number) =>
      service.createUploadTicket({
        key,
        contentType,
        subject: OWNER,
        ...(maxBytes === undefined ? {} : { maxBytes }),
      });

    it('issues a non-direct ticket for the local driver', async () => {
      const ticket = await ticketFor(StorageKeys.personPhoto(OWNER, 'jpg'));
      expect(ticket.isDirect).toBe(false);
      expect(ticket.uploadUrl).toContain('/api/v1/files/upload');
      expect(ticket.uploadUrl).not.toContain(ticket.ticket);
    });

    it('accepts only the PRD A-10 formats', async () => {
      for (const contentType of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
        await expect(
          ticketFor(StorageKeys.personPhoto(OWNER, 'jpg'), contentType),
        ).resolves.toBeDefined();
      }
      for (const contentType of ['image/gif', 'image/svg+xml', 'application/pdf', 'text/html']) {
        expect(
          await errorCodeOfAsync(() =>
            ticketFor(StorageKeys.personPhoto(OWNER, 'jpg'), contentType),
          ),
        ).toBe('IMAGE_FORMAT_UNSUPPORTED');
      }
    });

    it('clamps a requested ceiling to STORAGE_MAX_UPLOAD_MB', async () => {
      const ticket = await ticketFor(StorageKeys.personPhoto(OWNER, 'jpg'), 'image/jpeg', 1 << 30);
      const token = ticket.ticket;
      expect(signedUrls.verifyUploadTicket(token, { subject: OWNER }).maxBytes).toBe(MAX_BYTES);
    });

    it('redeems by streaming to disk and returns the stored result', async () => {
      const key = StorageKeys.personPhoto(OWNER, 'jpg');
      const ticket = await ticketFor(key);
      const token = ticket.ticket;
      const body = jpegBytes('photo-bytes');

      const result = await service.redeemUploadTicket(token, Readable.from([body]), OWNER);

      expect(result.key).toBe(key);
      expect(result.sha256).toBe(createHash('sha256').update(body).digest('hex'));
      expect(await service.getBuffer(key)).toEqual(body);
    });

    it('cannot be redeemed by another account', async () => {
      const ticket = await ticketFor(StorageKeys.personPhoto(OWNER, 'jpg'));
      const token = ticket.ticket;

      expect(
        await errorCodeOfAsync(() => service.redeemUploadTicket(token, jpegBytes('theirs'), OTHER)),
      ).toBe('UPLOAD_TICKET_INVALID');
    });

    it('enforces the ticket byte ceiling at redemption', async () => {
      const key = StorageKeys.personPhoto(OWNER, 'jpg');
      const ticket = await ticketFor(key, 'image/jpeg', 32);
      const token = ticket.ticket;

      expect(
        await errorCodeOfAsync(() =>
          service.redeemUploadTicket(token, jpegBytes('x'.repeat(64)), OWNER),
        ),
      ).toBe('IMAGE_TOO_LARGE');
      expect(await service.exists(key)).toBe(false);
    });

    it('rejects bytes that do not match the declared type (§3.2 requirement 9)', async () => {
      const key = StorageKeys.personPhoto(OWNER, 'jpg');
      const ticket = await ticketFor(key);
      const token = ticket.ticket;

      expect(
        await errorCodeOfAsync(() =>
          service.redeemUploadTicket(token, pngBytes('actually-a-png'), OWNER),
        ),
      ).toBe('IMAGE_FORMAT_UNSUPPORTED');
    });
  });

  describe('deleteUserObjects (§3.3, C-38)', () => {
    it('sweeps person-photos and renders for one user and counts what went', async () => {
      await service.put(StorageKeys.personPhoto(OWNER, 'jpg'), jpegBytes('a'), {
        contentType: 'image/jpeg',
      });
      await service.put(StorageKeys.render(OWNER, 'png'), pngBytes('b'), {
        contentType: 'image/png',
      });
      await service.put(StorageKeys.render(OWNER, 'png'), pngBytes('c'), {
        contentType: 'image/png',
      });

      const otherKey = StorageKeys.render(OTHER, 'png');
      await service.put(otherKey, pngBytes('d'), { contentType: 'image/png' });

      expect(await service.deleteUserObjects(OWNER)).toBe(3);
      expect(await service.exists(otherKey)).toBe(true);
    });
  });

  describe('content hashing (§3.7)', () => {
    it('matches the sha256 a put returns', async () => {
      const body = pngBytes('same-bytes');
      const stored = await service.put(StorageKeys.render(OWNER, 'png'), body, {
        contentType: 'image/png',
      });
      expect(service.contentHash(body)).toBe(stored.sha256);
    });

    it('builds the three-part cache key and invalidates on an API version bump', () => {
      expect(service.cacheKey('g', 'p', 'v1')).not.toBe(service.cacheKey('g', 'p', 'v2'));
    });
  });

  describe('free space (E-14)', () => {
    it('reports the volume state for /health/ready', async () => {
      const report = await service.freeSpace();
      expect(report.minFreeBytes).toBe(0);
      expect(report.ok).toBe(true);
    });
  });
});
