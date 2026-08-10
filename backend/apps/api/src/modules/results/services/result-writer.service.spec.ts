import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import sharp from 'sharp';

import { ImageService, StorageService } from '@library/storage';

import { TryOnResult } from '../entities/tryon-result.entity';

import { ResultWriterService } from './result-writer.service';

/**
 * `storeRender` — the write that turns upstream bytes into a stored render.
 *
 * The one behaviour under test here is the one that was wrong in production: the format was
 * *assumed* to be PNG, in both the declared content type and the key's extension, on the
 * strength of a comment. TryOnCloud returns JPEG. `LocalDiskDriver` validates the declared type
 * against the magic bytes (§3.2 requirement 9), so the mismatch did not produce an oddly-named
 * file — it refused the write and failed the generation as `IMAGE_FORMAT_UNSUPPORTED`, after
 * the upstream image had been produced and paid for.
 *
 * Nothing caught it because `MockTryOnProvider` produces PNG and is the driver everywhere except
 * production, so every existing test agreed with the assumption. These cases assert the bytes
 * decide, using real encoded images rather than fixtures with the right first eight bytes.
 */
describe('ResultWriterService.storeRender', () => {
  const USER = '11111111-2222-4333-8444-555555555555';

  let service: ResultWriterService;
  let put: jest.Mock;

  async function encode(format: 'png' | 'jpeg' | 'webp'): Promise<Buffer> {
    const canvas = sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 30, b: 90 } },
    });
    return format === 'png'
      ? canvas.png().toBuffer()
      : format === 'jpeg'
        ? canvas.jpeg().toBuffer()
        : canvas.webp().toBuffer();
  }

  beforeEach(async () => {
    put = jest.fn(async (key: string) => ({ key, size: 1234 }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResultWriterService,
        { provide: getRepositoryToken(TryOnResult), useValue: { findOne: jest.fn() } },
        { provide: StorageService, useValue: { put, copy: jest.fn() } },
        {
          provide: ImageService,
          // The thumbnail is a separate concern and has its own failure path; stub it so a
          // sharp round trip does not decide whether these assertions run.
          useValue: { toWebpThumbnail: jest.fn(async () => Buffer.from('webp')) },
        },
      ],
    }).compile();

    service = moduleRef.get(ResultWriterService);
  });

  /** The `put` call for the render itself — the thumbnail also goes through `put`. */
  function renderPut(): { key: string; contentType: string } {
    const call = put.mock.calls.find(([key]: [string]) => String(key).startsWith('renders/'));
    if (call === undefined) throw new Error('no render was written');
    return { key: String(call[0]), contentType: String(call[2].contentType) };
  }

  it('declares image/jpeg and a .jpg key for the JPEG TryOnCloud actually returns', async () => {
    await service.storeRender(USER, await encode('jpeg'), { width: 8, height: 8 });

    const { key, contentType } = renderPut();
    expect(contentType).toBe('image/jpeg');
    expect(key).toMatch(new RegExp(`^renders/${USER}/[0-9a-f-]{36}\\.jpg$`));
  });

  it('still declares image/png for PNG bytes', async () => {
    await service.storeRender(USER, await encode('png'), { width: 8, height: 8 });

    const { key, contentType } = renderPut();
    expect(contentType).toBe('image/png');
    expect(key).toMatch(new RegExp(`^renders/${USER}/[0-9a-f-]{36}\\.png$`));
  });

  it('follows the bytes for any raster format, not just the two it expects', async () => {
    await service.storeRender(USER, await encode('webp'), { width: 8, height: 8 });

    const { key, contentType } = renderPut();
    expect(contentType).toBe('image/webp');
    expect(key).toMatch(/\.webp$/);
  });

  it('reports the key the storage layer returned, not the one it proposed', async () => {
    const stored = await service.storeRender(USER, await encode('jpeg'), { width: 8, height: 8 });

    expect(stored.storageKey).toBe(renderPut().key);
    expect(stored.byteSize).toBe(1234);
    expect(stored.width).toBe(8);
    expect(stored.height).toBe(8);
  });
});
