'use client';

import { decodeImage } from '@/features/photos/lib/validate-photo';

/**
 * Client-side compression and EXIF stripping — PRD C-15.
 *
 * > "Client-side compression and EXIF stripping. Upload goes directly to storage via a
 * > pre-signed URL, never through the app server."
 *
 * **The EXIF strip is the re-encode.** Decoding to a bitmap and drawing to a canvas produces raw
 * pixels; `canvas.toBlob` writes a fresh JPEG from them with no metadata block at all. There is
 * no tag list to maintain and nothing to miss — no GPS coordinates, no device serial, no capture
 * timestamp, no thumbnail-of-the-original (which is its own leak, because an EXIF thumbnail
 * survives cropping).
 *
 * Orientation is the one tag that must not simply be dropped: `imageOrientation: 'from-image'`
 * applies the rotation during decode, so the pixels come out upright and the tag becomes
 * redundant rather than lost.
 *
 * Compression is the other half. A 12-megapixel phone photo is 4–6 MB; upstream works from
 * roughly 1600px on the long edge, and on mobile data the difference is the whole experience.
 */

/** Upstream gains nothing above this, and every pixel past it is her bandwidth. */
export const MAX_UPLOAD_EDGE = 1600;

/** High enough that fabric texture survives, low enough to be about 300 KB at 1600px. */
export const JPEG_QUALITY = 0.86;

export interface PreparedPhoto {
  file: File;
  width: number;
  height: number;
  /** The original byte count, so the UI can say what the compression saved. */
  originalBytes: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Returns a JPEG with no metadata, scaled to fit `MAX_UPLOAD_EDGE`.
 *
 * Returns `null` when the file cannot be decoded — the caller has already run the C-14
 * validator, so a failure here is a broken file rather than an unsupported one, and it surfaces
 * as the same actionable `DECODE` message.
 */
export async function preparePhotoForUpload(file: File): Promise<PreparedPhoto | null> {
  const bitmap = await decodeImage(file);
  if (bitmap === null) return null;

  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (context === null) {
    bitmap.close();
    return null;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await canvasToBlob(canvas, JPEG_QUALITY);
  // Release the backing store rather than waiting for the collector; a 1600px canvas is ~10 MB
  // and a mid-range Android will notice.
  canvas.width = 0;
  canvas.height = 0;

  if (blob === null) return null;

  return {
    file: new File([blob], 'photo.jpg', { type: 'image/jpeg', lastModified: Date.now() }),
    width,
    height,
    originalBytes: file.size,
  };
}
