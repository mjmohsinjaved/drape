/**
 * ARCHITECTURE §3.5 step 2 / PRD C-15 — redeeming an upload ticket.
 *
 * This is the only route bytes enter through, so the tests are about refusal: an expired
 * ticket, somebody else's ticket, a file that outgrows its ceiling halfway through, a file whose
 * magic bytes contradict what the ticket committed to, and a key shaped like a path traversal.
 *
 * The `SignedUrlService` is real. The `StorageService` double drains whatever stream it is
 * handed, exactly as the driver would, so a guard that only rejected on a fully buffered body
 * would fail these tests rather than pass them.
 */
import { Readable } from 'node:stream';

import { ErrorCode } from '@library/common';
import {
  type ImageService,
  type StorageService,
  type PutResult,
  type SignedUrlService,
} from '@library/storage';

import { createMock } from '../../../../test/fixtures';
import {
  CONSUMER,
  CONSUMER_ID,
  createSignedUrlService,
  GARMENT_ID,
  OTHER_CONSUMER,
} from '../testing/files-fixtures';

import { FileUploadService } from './file-upload.service';

const MEGABYTE = 1024 * 1024;

const PHOTO_KEY = `person-photos/${CONSUMER_ID}/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.jpg`;
const GARMENT_KEY = `garments/${GARMENT_ID}/aaaa1111-2222-4333-8444-555566667777.jpg`;

const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function fileOf(signature: readonly number[], size: number): Buffer {
  const head = Buffer.from(signature);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x20)]);
}

function chunked(buffer: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

interface Harness {
  service: FileUploadService;
  storage: jest.Mocked<StorageService>;
  images: jest.Mocked<ImageService>;
  signedUrls: SignedUrlService;
  /** Bytes the storage double actually received, per call. */
  written: Buffer[];
}

function build(): Harness {
  const signedUrls = createSignedUrlService();
  const written: Buffer[] = [];

  const storage = createMock<StorageService>(['redeemUploadTicket', 'put', 'getBuffer', 'delete']);

  // Behaves like the driver: verifies the ticket, then *drains the stream*. A guard that
  // deferred its checks to the end of the body would still be exercised by this.
  storage.redeemUploadTicket.mockImplementation(async (token, body, subject) => {
    const ticket = signedUrls.verifyUploadTicket(token, { subject });
    const chunks: Buffer[] = [];
    for await (const chunk of body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const buffer = Buffer.concat(chunks);
    written.push(buffer);
    return {
      key: ticket.key,
      size: buffer.byteLength,
      sha256: 'e'.repeat(64),
      mimeType: ticket.contentType,
    } satisfies PutResult;
  });

  storage.getBuffer.mockResolvedValue(fileOf(JPEG_MAGIC, 4096));
  storage.put.mockImplementation((key) =>
    Promise.resolve<PutResult>({ key, size: 3072, sha256: 'd'.repeat(64), mimeType: 'image/jpeg' }),
  );
  storage.delete.mockResolvedValue(true);

  const images = createMock<ImageService>(['stripExif']);
  images.stripExif.mockResolvedValue(fileOf(JPEG_MAGIC, 3072));

  return {
    service: new FileUploadService(storage, signedUrls, images),
    storage,
    images,
    signedUrls,
    written,
  };
}

function issue(
  harness: Harness,
  options: {
    key?: string;
    subject?: string;
    contentType?: string;
    maxBytes?: number;
    ttlSeconds?: number;
    now?: Date;
  } = {},
): string {
  return harness.signedUrls.issueUploadTicket(options.key ?? GARMENT_KEY, {
    subject: options.subject ?? CONSUMER_ID,
    contentType: options.contentType ?? 'image/jpeg',
    maxBytes: options.maxBytes ?? 5 * MEGABYTE,
    ttlSeconds: options.ttlSeconds ?? 900,
    ...(options.now === undefined ? {} : { now: options.now }),
  }).token;
}

describe('FileUploadService — ticket validity (§3.5)', () => {
  it('accepts a valid ticket redeemed by the account it was issued to', async () => {
    const harness = build();
    const ticket = issue(harness);

    const result = await harness.service.redeem(
      ticket,
      Readable.from([fileOf(JPEG_MAGIC, 4096)]),
      CONSUMER,
    );

    expect(result.key).toBe(GARMENT_KEY);
    expect(result.byteSize).toBe(4096);
    expect(result.contentType).toBe('image/jpeg');
  });

  it('refuses a ticket redeemed by another account', async () => {
    const harness = build();
    const ticket = issue(harness);

    await expect(
      harness.service.redeem(ticket, Readable.from([fileOf(JPEG_MAGIC, 4096)]), OTHER_CONSUMER),
    ).rejects.toMatchObject({ errorCode: ErrorCode.UPLOAD_TICKET_INVALID });

    expect(harness.written).toHaveLength(0);
  });

  it('refuses a ticket redeemed with no session', async () => {
    const harness = build();
    const ticket = issue(harness);

    await expect(
      harness.service.redeem(ticket, Readable.from([fileOf(JPEG_MAGIC, 4096)]), undefined),
    ).rejects.toMatchObject({ errorCode: ErrorCode.UPLOAD_TICKET_INVALID });
  });

  it('refuses an expired ticket', async () => {
    const harness = build();
    const issuedAt = new Date('2026-08-01T00:00:00.000Z');
    const ticket = issue(harness, { ttlSeconds: 900, now: issuedAt });

    jest.useFakeTimers().setSystemTime(new Date(issuedAt.getTime() + 901_000));
    try {
      await expect(
        harness.service.redeem(ticket, Readable.from([fileOf(JPEG_MAGIC, 4096)]), CONSUMER),
      ).rejects.toMatchObject({ errorCode: ErrorCode.UPLOAD_TICKET_EXPIRED });
    } finally {
      jest.useRealTimers();
    }

    expect(harness.written).toHaveLength(0);
  });

  it('refuses a download token replayed as an upload ticket (§3.5 domain separator)', async () => {
    const harness = build();
    const downloadToken = harness.signedUrls.issue(GARMENT_KEY);

    await expect(
      harness.service.redeem(downloadToken, Readable.from([fileOf(JPEG_MAGIC, 512)]), CONSUMER),
    ).rejects.toMatchObject({ errorCode: ErrorCode.UPLOAD_TICKET_INVALID });
  });

  it('refuses a ticket whose key is shaped like a path traversal', async () => {
    const harness = build();

    // `issueUploadTicket` refuses to sign it at all — the key never becomes a credential.
    expect(() => issue(harness, { key: '../../../etc/passwd' })).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.STORAGE_PATH_REJECTED }),
    );
    expect(() => issue(harness, { key: 'garments/../person-photos/x.jpg' })).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.STORAGE_PATH_REJECTED }),
    );
    expect(() => issue(harness, { key: 'C:\\windows\\system32\\a.jpg' })).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.STORAGE_PATH_REJECTED }),
    );
  });

  it('refuses a signed ticket whose key belongs to no upload purpose', async () => {
    const harness = build();
    // A validly signed ticket pointing at the render namespace — nothing may write there.
    const ticket = issue(harness, {
      key: `renders/${CONSUMER_ID}/aaaa1111-2222-4333-8444-555566667777.png`,
    });

    await expect(
      harness.service.redeem(ticket, Readable.from([fileOf(JPEG_MAGIC, 512)]), CONSUMER),
    ).rejects.toMatchObject({ errorCode: ErrorCode.UPLOAD_TICKET_INVALID });

    expect(harness.written).toHaveLength(0);
  });
});

describe('FileUploadService — the ceiling and the format (§3.5 step 2)', () => {
  it('refuses a body that exceeds the ticket ceiling mid-stream', async () => {
    const harness = build();
    const ticket = issue(harness, { maxBytes: 4096 });
    const oversized = fileOf(JPEG_MAGIC, 16_384);

    await expect(
      harness.service.redeem(ticket, Readable.from(chunked(oversized, 1024)), CONSUMER),
    ).rejects.toMatchObject({ errorCode: ErrorCode.IMAGE_TOO_LARGE });

    // Nothing was handed on as a finished write; the driver would have unlinked its temp file.
    expect(harness.written).toHaveLength(0);
  });

  it('refuses bytes whose magic number contradicts the ticket', async () => {
    const harness = build();
    const ticket = issue(harness, { contentType: 'image/jpeg' });

    await expect(
      harness.service.redeem(ticket, Readable.from([fileOf(PNG_MAGIC, 4096)]), CONSUMER),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.IMAGE_FORMAT_UNSUPPORTED,
      details: { declared: 'image/jpeg', detected: 'image/png' },
    });
  });

  it('believes the bytes rather than the ticket’s owner about the ceiling', async () => {
    // The client asked for a 25 MB ticket and got one; it still cannot send 26 MB.
    const harness = build();
    const ticket = issue(harness, { maxBytes: 2048 });

    await expect(
      harness.service.redeem(
        ticket,
        Readable.from(chunked(fileOf(JPEG_MAGIC, 4096), 512)),
        CONSUMER,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.IMAGE_TOO_LARGE });
  });
});

describe('FileUploadService — EXIF stripping (PRD C-15, §3.6)', () => {
  it('re-encodes a person photo so its metadata cannot survive the upload', async () => {
    const harness = build();
    const ticket = issue(harness, { key: PHOTO_KEY });

    const result = await harness.service.redeem(
      ticket,
      Readable.from([fileOf(JPEG_MAGIC, 4096)]),
      CONSUMER,
    );

    expect(harness.images.stripExif).toHaveBeenCalledTimes(1);
    expect(harness.storage.put).toHaveBeenCalledWith(
      PHOTO_KEY,
      expect.any(Buffer),
      expect.objectContaining({ failIfExists: false }),
    );
    // The size reported is the size of what is actually on disk after the re-encode.
    expect(result.byteSize).toBe(3072);
  });

  it('leaves a garment photograph as shot', async () => {
    const harness = build();
    const ticket = issue(harness, { key: GARMENT_KEY });

    await harness.service.redeem(ticket, Readable.from([fileOf(JPEG_MAGIC, 4096)]), CONSUMER);

    expect(harness.images.stripExif).not.toHaveBeenCalled();
    expect(harness.storage.put).not.toHaveBeenCalled();
  });

  it('deletes the object when the metadata cannot be stripped, rather than keeping it', async () => {
    const harness = build();
    harness.images.stripExif.mockRejectedValue(
      Object.assign(new Error('decode failed'), { errorCode: ErrorCode.IMAGE_CORRUPT }),
    );
    const ticket = issue(harness, { key: PHOTO_KEY });

    await expect(
      harness.service.redeem(ticket, Readable.from([fileOf(JPEG_MAGIC, 4096)]), CONSUMER),
    ).rejects.toMatchObject({ errorCode: ErrorCode.IMAGE_CORRUPT });

    expect(harness.storage.delete).toHaveBeenCalledWith(PHOTO_KEY);
  });
});
