/**
 * ARCHITECTURE.md §3.6. Fixtures are synthesised with `sharp` — nothing is read from disk and the
 * real `STORAGE_ROOT` is never touched.
 */
import sharp from 'sharp';

import { ImageService } from './image.service';

const service = new ImageService();

async function solid(
  width: number,
  height: number,
  colour: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();
}

/** A white frame with a black square in the middle — one obvious dominant subject. */
async function centredSquare(): Promise<Buffer> {
  const square = await solid(200, 200, { r: 0, g: 0, b: 0 });
  return sharp({
    create: { width: 400, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: square, left: 100, top: 100 }])
    .png()
    .toBuffer();
}

/** Uniform noise — no background to speak of. */
async function noise(): Promise<Buffer> {
  const pixels = Buffer.alloc(256 * 256 * 3);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 97 + ((index * 31) % 251)) % 256;
  }
  return sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } })
    .png()
    .toBuffer();
}

function errorCodeOf(error: unknown): string {
  const code = (error as { errorCode?: unknown }).errorCode;
  return typeof code === 'string' ? code : `<${String(error)}>`;
}

describe('ImageService', () => {
  describe('metadata', () => {
    it('reports dimensions and format', async () => {
      const meta = await service.metadata(await solid(120, 80, { r: 10, g: 20, b: 30 }));

      expect(meta.width).toBe(120);
      expect(meta.height).toBe(80);
      expect(meta.format).toBe('png');
      expect(meta.byteSize).toBeGreaterThan(0);
    });

    it('raises IMAGE_CORRUPT rather than leaking a sharp message', async () => {
      expect.assertions(1);
      try {
        await service.metadata(Buffer.from('not an image'));
        throw new Error('expected a rejection');
      } catch (error) {
        expect(errorCodeOf(error)).toBe('IMAGE_CORRUPT');
      }
    });
  });

  describe('stripExif (PRD C-15)', () => {
    it('drops metadata the client left behind', async () => {
      const withExif = await sharp(await solid(40, 40, { r: 200, g: 100, b: 50 }))
        .jpeg()
        .withMetadata({ exif: { IFD0: { Copyright: 'DRAPE-EXIF-CANARY' } } })
        .toBuffer();
      expect(withExif.includes(Buffer.from('DRAPE-EXIF-CANARY'))).toBe(true);

      const stripped = await service.stripExif(withExif);

      expect(stripped.includes(Buffer.from('DRAPE-EXIF-CANARY'))).toBe(false);
    });

    it('applies orientation to the pixels instead of leaving it in a tag', async () => {
      const rotated = await sharp(await solid(60, 30, { r: 0, g: 0, b: 255 }))
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();

      const stripped = await service.stripExif(rotated);
      const meta = await service.metadata(stripped);

      expect([meta.width, meta.height]).toEqual([30, 60]);
    });
  });

  describe('toWebpThumbnail (§3.6)', () => {
    it('produces a webp at the requested width', async () => {
      const thumbnail = await service.toWebpThumbnail(await centredSquare(), 320);
      const meta = await sharp(thumbnail).metadata();

      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(320);
      expect(meta.height).toBe(320);
    });

    it('preserves the aspect ratio with fit: inside for detail views', async () => {
      const thumbnail = await service.toWebpThumbnail(
        await solid(800, 400, { r: 1, g: 2, b: 3 }),
        640,
        {
          fit: 'inside',
        },
      );
      const meta = await sharp(thumbnail).metadata();

      expect(meta.width).toBe(640);
      expect(meta.height).toBe(320);
    });

    it('never enlarges a small source', async () => {
      const thumbnail = await service.toWebpThumbnail(
        await solid(100, 100, { r: 9, g: 9, b: 9 }),
        640,
      );
      expect((await sharp(thumbnail).metadata()).width).toBe(100);
    });
  });

  describe('blur (PRD A-34)', () => {
    it('changes the pixels while keeping the frame', async () => {
      const source = await centredSquare();
      const blurred = await service.blur(source, 28);
      const meta = await sharp(blurred).metadata();

      expect(meta.width).toBe(400);
      expect(meta.height).toBe(400);
      expect(blurred.equals(source)).toBe(false);
    });

    it('produces the 160w blurred moderation thumbnail', async () => {
      const thumbnail = await service.toBlurredModerationThumbnail(await centredSquare());
      const meta = await sharp(thumbnail).metadata();

      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(160);
    });
  });

  describe('resize', () => {
    it('fits inside the requested box', async () => {
      const resized = await service.resize(await solid(800, 400, { r: 4, g: 5, b: 6 }), {
        width: 200,
        height: 200,
      });
      const meta = await sharp(resized).metadata();

      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
    });
  });

  describe('watermark (PRD C-23)', () => {
    it('composites the default mark without changing the frame', async () => {
      const source = await centredSquare();
      const marked = await service.watermark(source);
      const meta = await sharp(marked).metadata();

      expect(meta.width).toBe(400);
      expect(meta.height).toBe(400);
      expect(marked.equals(source)).toBe(false);
    });

    it('accepts a brand asset and honours the direction', async () => {
      const mark = await solid(60, 20, { r: 255, g: 0, b: 0 });
      const source = await centredSquare();

      const ltr = await service.watermark(source, { mark, direction: 'ltr' });
      const rtl = await service.watermark(source, { mark, direction: 'rtl' });

      expect(ltr.equals(rtl)).toBe(false);
    });
  });

  describe('probeQuality (PRD A-10 measurements only)', () => {
    it('reports the long edge and aspect ratio the validator needs', async () => {
      const measurements = await service.probeQuality(
        await solid(2400, 1600, { r: 250, g: 250, b: 250 }),
      );

      expect(measurements.width).toBe(2400);
      expect(measurements.height).toBe(1600);
      expect(measurements.longEdgePx).toBe(2400);
      expect(measurements.shortEdgePx).toBe(1600);
      expect(measurements.aspectRatio).toBeCloseTo(1.5, 5);
    });

    it('sees a clean background and one dominant subject', async () => {
      const measurements = await service.probeQuality(await centredSquare());

      expect(measurements.backgroundUniformity).toBeGreaterThan(0.95);
      expect(measurements.subjectPixelRatio).toBeGreaterThan(0.2);
      expect(measurements.subjectPixelRatio).toBeLessThan(0.3);
      // A single compact subject: the bounding box is barely larger than the subject itself.
      expect(measurements.subjectBoundingBoxRatio).toBeLessThan(
        measurements.subjectPixelRatio * 1.3,
      );
      expect(Math.abs(measurements.subjectCentroidOffset.x)).toBeLessThan(0.05);
      expect(Math.abs(measurements.subjectCentroidOffset.y)).toBeLessThan(0.05);
    });

    it('reports a low background uniformity for a busy frame', async () => {
      const measurements = await service.probeQuality(await noise());
      expect(measurements.backgroundUniformity).toBeLessThan(0.7);
    });

    it('returns measurements only — no score, no verdict, no threshold', async () => {
      const measurements = await service.probeQuality(await centredSquare());
      for (const forbidden of ['score', 'passed', 'ok', 'checks', 'threshold']) {
        expect(Object.keys(measurements)).not.toContain(forbidden);
      }
    });
  });
});
