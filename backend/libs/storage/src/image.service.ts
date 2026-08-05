/**
 * ARCHITECTURE.md §3.6 — image processing with `sharp`.
 *
 * This service is deliberately *measurement only* where PRD A-10 is concerned. It reports the long
 * edge, the aspect ratio, a background-uniformity estimate and a dominant-subject estimate; it does
 * **not** score them and it does not know the thresholds. The A-10 scoring, the "Needs a better
 * photo" verdict and the remediation copy belong to the garments module's validators, where they can
 * be pure functions over these numbers and unit-tested on their own (E-5).
 */
import { Injectable } from '@nestjs/common';

import sharp from 'sharp';

import { imageCorrupt } from './exceptions/storage.exception';

import type { ThumbnailWidth } from './storage-key.builder';

export interface ImageMetadata {
  width: number;
  height: number;
  /** `jpeg | png | webp | heif | …` as reported by sharp. */
  format: string;
  byteSize: number;
  hasAlpha: boolean;
  /** EXIF orientation, 1 when absent. */
  orientation: number;
}

export interface ThumbnailOptions {
  /** `cover` for grid tiles, `inside` for detail views (§3.6). */
  fit?: 'cover' | 'inside';
  /** Only meaningful with `fit: 'cover'`. Defaults to a square tile. */
  height?: number;
  /** §3.6 fixes this at 78. */
  quality?: number;
}

export interface ResizeOptions {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'inside' | 'outside' | 'fill';
  withoutEnlargement?: boolean;
}

export interface WatermarkOptions {
  /** Bytes of the `brand/` asset. Falls back to a rendered text mark when absent. */
  mark?: Buffer;
  /** Text for the fallback mark. */
  text?: string;
  /** §3.6: 55 %. */
  opacity?: number;
  /** §3.6: 6 % of the long edge. */
  longEdgeRatio?: number;
  /** Inset from the two nearest edges, as a fraction of the long edge. */
  marginRatio?: number;
  /**
   * §3.6 says "bottom-inline-end", which is a logical position: bottom-right in an LTR layout,
   * bottom-left in Urdu (PRD D-10). The caller knows the locale; this library does not.
   */
  direction?: 'ltr' | 'rtl';
}

/**
 * Raw measurements for the PRD A-10 garment-image validator. No thresholds, no score, no verdict —
 * those live in `apps/api/src/modules/garments/validators/`.
 */
export interface ImageQualityMeasurements {
  width: number;
  height: number;
  /** A-10 "minimum 2000px on the long edge" is decided by the caller from this number. */
  longEdgePx: number;
  shortEdgePx: number;
  /** `width / height`. A-10 "aspect ratio within band" is decided by the caller from this number. */
  aspectRatio: number;
  format: string;
  byteSize: number;
  hasAlpha: boolean;
  /**
   * A-10 "background uniformity", `0`–`1`. `1` means every sampled border pixel is the same colour.
   * Estimated from the outer frame of a 256px downscale (§3.6).
   */
  backgroundUniformity: number;
  /**
   * A-10 "single dominant garment detected", part one: the fraction of pixels that differ from the
   * estimated background colour, `0`–`1`.
   */
  subjectPixelRatio: number;
  /**
   * Part two: the area of the bounding box around those pixels, as a fraction of the frame. A single
   * dominant subject gives a `subjectBoundingBoxRatio` close to `subjectPixelRatio`; scattered
   * clutter or several garments give a much larger box than the pixel count justifies.
   */
  subjectBoundingBoxRatio: number;
  /** Offset of the subject centroid from the centre of the frame, each axis `-1`–`1`. */
  subjectCentroidOffset: { x: number; y: number };
  /** The downscale the estimates were taken on, so a caller can reason about their precision. */
  sample: { width: number; height: number };
}

/** §3.6 — background/subject estimates run on a 256px downscale. */
const PROBE_SAMPLE_SIZE = 256;

/** §3.6 — webp quality 78 for every thumbnail. */
const THUMBNAIL_QUALITY = 78;

/** §3.6 / PRD A-34 — the blurred moderation thumbnail. */
const MODERATION_BLUR_SIGMA = 28;
const MODERATION_THUMBNAIL_WIDTH: ThumbnailWidth = 160;

const WATERMARK_DEFAULTS = {
  text: 'Drape',
  opacity: 0.55,
  longEdgeRatio: 0.06,
  marginRatio: 0.02,
  direction: 'ltr',
} as const;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

@Injectable()
export class ImageService {
  /* ---------------------------------------------------------------------------------------------
   * Probing
   * ------------------------------------------------------------------------------------------ */

  async metadata(buffer: Buffer): Promise<ImageMetadata> {
    const meta = await this.run(() => sharp(buffer).metadata());
    if (meta.width === undefined || meta.height === undefined || meta.format === undefined) {
      throw imageCorrupt();
    }
    return {
      width: meta.width,
      height: meta.height,
      format: meta.format,
      byteSize: meta.size ?? buffer.byteLength,
      hasAlpha: meta.hasAlpha ?? false,
      orientation: meta.orientation ?? 1,
    };
  }

  /**
   * PRD A-10 measurements. Everything here is an observation; nothing is a judgement.
   *
   * The background estimate takes the mean colour of the outer frame of a 256px downscale and
   * reports how tightly the frame clusters around it. The subject estimate counts the pixels that
   * sit far enough from that mean to be foreground, and boxes them.
   */
  async probeQuality(buffer: Buffer): Promise<ImageQualityMeasurements> {
    const meta = await this.metadata(buffer);

    const { data, info } = await this.run(() =>
      sharp(buffer)
        .rotate()
        .resize(PROBE_SAMPLE_SIZE, PROBE_SAMPLE_SIZE, { fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
    );

    const { width: sampleWidth, height: sampleHeight, channels } = info;
    const pixelAt = (x: number, y: number): [number, number, number] => {
      const offset = (y * sampleWidth + x) * channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };

    // Frame thickness: ~6 % of the shorter sample edge, at least two pixels.
    const border = Math.max(2, Math.round(Math.min(sampleWidth, sampleHeight) * 0.06));
    const isBorder = (x: number, y: number): boolean =>
      x < border || y < border || x >= sampleWidth - border || y >= sampleHeight - border;

    let borderCount = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        if (!isBorder(x, y)) {
          continue;
        }
        const [r, g, b] = pixelAt(x, y);
        sumR += r;
        sumG += g;
        sumB += b;
        borderCount += 1;
      }
    }

    if (borderCount === 0) {
      throw imageCorrupt();
    }

    const meanR = sumR / borderCount;
    const meanG = sumG / borderCount;
    const meanB = sumB / borderCount;

    const distanceToBackground = (x: number, y: number): number => {
      const [r, g, b] = pixelAt(x, y);
      return Math.sqrt((r - meanR) ** 2 + (g - meanG) ** 2 + (b - meanB) ** 2);
    };

    let borderDistanceSum = 0;
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        if (isBorder(x, y)) {
          borderDistanceSum += distanceToBackground(x, y);
        }
      }
    }
    const meanBorderDistance = borderDistanceSum / borderCount;

    // A flat studio background sits within a couple of levels of its own mean; 64 is the distance at
    // which a "background" has stopped being one.
    const backgroundUniformity = clamp01(1 - meanBorderDistance / 64);

    // Foreground threshold: comfortably outside the background's own spread, never below 24 levels.
    const foregroundThreshold = Math.max(24, meanBorderDistance * 3);

    let subjectPixels = 0;
    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;
    let centroidX = 0;
    let centroidY = 0;

    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        if (distanceToBackground(x, y) <= foregroundThreshold) {
          continue;
        }
        subjectPixels += 1;
        centroidX += x;
        centroidY += y;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const totalPixels = sampleWidth * sampleHeight;
    const boundingBoxArea = maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1);

    return {
      width: meta.width,
      height: meta.height,
      longEdgePx: Math.max(meta.width, meta.height),
      shortEdgePx: Math.min(meta.width, meta.height),
      aspectRatio: meta.height === 0 ? 0 : meta.width / meta.height,
      format: meta.format,
      byteSize: meta.byteSize,
      hasAlpha: meta.hasAlpha,
      backgroundUniformity,
      subjectPixelRatio: clamp01(subjectPixels / totalPixels),
      subjectBoundingBoxRatio: clamp01(boundingBoxArea / totalPixels),
      subjectCentroidOffset:
        subjectPixels === 0
          ? { x: 0, y: 0 }
          : {
              x: (centroidX / subjectPixels / sampleWidth) * 2 - 1,
              y: (centroidY / subjectPixels / sampleHeight) * 2 - 1,
            },
      sample: { width: sampleWidth, height: sampleHeight },
    };
  }

  /* ---------------------------------------------------------------------------------------------
   * Transforms
   * ------------------------------------------------------------------------------------------ */

  /**
   * PRD C-15 / §3.6 — every `person-photos/**` write is re-encoded with
   * `.rotate().withMetadata({ exif: {} })`: orientation is applied to the pixels, everything else
   * (GPS, device, timestamps) is dropped. Applied server-side even though the client also strips.
   */
  async stripExif(buffer: Buffer): Promise<Buffer> {
    // `.rotate()` with no argument bakes the EXIF orientation into the pixels;
    // sharp then writes no metadata at all unless `withMetadata()` is called.
    // Do NOT reintroduce `withMetadata({ exif: {} })` — that instructs sharp to
    // KEEP metadata and merges the empty object over what is already there, so
    // the original EXIF (GPS included) survives into the stored photo. PRD C-15
    // requires it gone before the file is ever written.
    return this.run(() => sharp(buffer).rotate().toBuffer());
  }

  /** §3.6 — thumbnails are generated on write, never on read. */
  async toWebpThumbnail(
    buffer: Buffer,
    width: number,
    options: ThumbnailOptions = {},
  ): Promise<Buffer> {
    const fit = options.fit ?? 'cover';
    return this.run(() =>
      sharp(buffer)
        .rotate()
        .resize({
          width,
          height: fit === 'cover' ? (options.height ?? width) : options.height,
          fit,
          withoutEnlargement: true,
        })
        .webp({ quality: options.quality ?? THUMBNAIL_QUALITY })
        .toBuffer(),
    );
  }

  /** PRD A-34 — the moderation queue shows a blurred thumbnail; the original is never readable. */
  async blur(buffer: Buffer, sigma: number = MODERATION_BLUR_SIGMA): Promise<Buffer> {
    return this.run(() => sharp(buffer).rotate().blur(sigma).toBuffer());
  }

  /**
   * §3.6 — `blur(28)` at 160w, written to `thumbnails/person-blurred/`. The blur is applied before
   * the downscale so the result cannot be sharpened back by upscaling.
   */
  async toBlurredModerationThumbnail(
    buffer: Buffer,
    width: number = MODERATION_THUMBNAIL_WIDTH,
    sigma: number = MODERATION_BLUR_SIGMA,
  ): Promise<Buffer> {
    return this.toWebpThumbnail(await this.blur(buffer, sigma), width, { fit: 'inside' });
  }

  async resize(buffer: Buffer, options: ResizeOptions): Promise<Buffer> {
    return this.run(() =>
      sharp(buffer)
        .rotate()
        .resize({
          width: options.width,
          height: options.height,
          fit: options.fit ?? 'inside',
          withoutEnlargement: options.withoutEnlargement ?? true,
        })
        .toBuffer(),
    );
  }

  /**
   * PRD C-23 / §3.6 — applied **at download time only**. Stored renders stay clean, so history and
   * re-download stay cheap and the mark can be restyled without a backfill.
   *
   * Bottom-inline-end, 6 % of the long edge, 55 % opacity, from the `brand/` asset or the packaged
   * text fallback.
   */
  async watermark(buffer: Buffer, options: WatermarkOptions = {}): Promise<Buffer> {
    const opacity = clamp01(options.opacity ?? WATERMARK_DEFAULTS.opacity);
    const longEdgeRatio = options.longEdgeRatio ?? WATERMARK_DEFAULTS.longEdgeRatio;
    const marginRatio = options.marginRatio ?? WATERMARK_DEFAULTS.marginRatio;
    const direction = options.direction ?? WATERMARK_DEFAULTS.direction;

    const base = await this.metadata(buffer);
    const longEdge = Math.max(base.width, base.height);
    const markHeight = Math.max(8, Math.round(longEdge * longEdgeRatio));
    const margin = Math.max(4, Math.round(longEdge * marginRatio));

    const markSource =
      options.mark ??
      Buffer.from(textMarkSvg(options.text ?? WATERMARK_DEFAULTS.text, markHeight), 'utf8');

    const opaqueMark = await this.run(() =>
      sharp(markSource)
        .resize({ height: markHeight, fit: 'inside', withoutEnlargement: false })
        .ensureAlpha()
        .png()
        .toBuffer(),
    );

    // `dest-in` multiplies the mark's alpha by the tile's alpha, which is the only way to dim an
    // arbitrary source (a logo may already carry transparency) uniformly.
    const mark = await this.run(() =>
      sharp(opaqueMark)
        .composite([
          {
            input: Buffer.from([255, 255, 255, Math.round(255 * opacity)]),
            raw: { width: 1, height: 1, channels: 4 },
            tile: true,
            blend: 'dest-in',
          },
        ])
        .png()
        .toBuffer(),
    );

    const markMeta = await this.metadata(mark);
    const left = direction === 'rtl' ? margin : Math.max(0, base.width - markMeta.width - margin);
    const top = Math.max(0, base.height - markMeta.height - margin);

    return this.run(() =>
      sharp(buffer)
        .rotate()
        .composite([{ input: mark, left, top }])
        .toBuffer(),
    );
  }

  /* ---------------------------------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------------------------------ */

  /** Any decode or encode failure is `IMAGE_CORRUPT` — sharp's own message never reaches a client. */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      throw imageCorrupt(cause);
    }
  }
}

/**
 * The packaged default mark. An SVG rather than a bundled binary so the library ships no assets and
 * the mark scales to any render size without resampling artefacts.
 */
function textMarkSvg(text: string, height: number): string {
  const fontSize = Math.round(height * 0.8);
  const width = Math.max(height, Math.round(text.length * fontSize * 0.62));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<text x="0" y="${Math.round(height * 0.78)}" `,
    `font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${fontSize}" `,
    `letter-spacing="${(fontSize * 0.06).toFixed(2)}" fill="#ffffff" `,
    `stroke="#000000" stroke-opacity="0.25" stroke-width="${Math.max(1, fontSize * 0.02).toFixed(2)}">`,
    escapeXml(text),
    '</text></svg>',
  ].join('');
}
