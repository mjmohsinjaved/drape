'use client';

import {
  ANALYSIS_EDGE,
  backgroundUniformity,
  buildSubjectMask,
  centreLuma,
  countSubjects,
  laplacianVariance,
  meanLuma,
  toGreyscale,
  type GreyImage,
} from '@/features/photos/lib/image-analysis';

/**
 * Client-side photo validation — PRD C-14.
 *
 * > "Client-side validation before upload: resolution, full-body framing heuristic, blur
 * > detection, single subject. **Rejections are specific and actionable.**"
 *
 * Which is the whole point of doing this here at all. The API re-derives every one of these from
 * the stored bytes and is the enforcement point (§5.9) — this exists so she finds out *before*
 * spending mobile data on an upload, and so the reason is "your feet are outside the frame"
 * rather than "invalid image".
 *
 * Every check returns a message key plus the numbers to interpolate, so the copy stays in
 * `photos.json` and translates. **No check ever produces a generic failure**: if the file cannot
 * even be decoded, that is its own named result with its own instruction.
 */

export const PHOTO_CHECKS = [
  'DECODE',
  'SUPPORTED_FORMAT',
  'MAX_FILE_SIZE',
  'MIN_RESOLUTION',
  'FULL_BODY_VISIBLE',
  'SINGLE_SUBJECT',
  'NOT_BLURRY',
  'ADEQUATE_LIGHTING',
  'PLAIN_BACKGROUND',
] as const;

export type PhotoCheck = (typeof PHOTO_CHECKS)[number];

export interface PhotoCheckResult {
  check: PhotoCheck;
  passed: boolean;
  /**
   * The key under `photos.checks.<CHECK>` to render on failure — `fail` for most, a variant for
   * the checks whose remedy differs by cause (`failPortrait`, `failDark`, `failBright`).
   */
  messageKey: string;
  /** Values to interpolate into that message. */
  values?: Record<string, string | number>;
}

export interface PhotoValidationResult {
  passed: boolean;
  results: PhotoCheckResult[];
  /** Present when the file decoded, so the caller can compress from the same bitmap. */
  dimensions: { width: number; height: number } | null;
}

/** §3.5 / A-10 accept the same four containers. HEIC is included because iPhones default to it. */
export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

/** Before compression. `STORAGE_MAX_UPLOAD_MB` bounds what actually leaves the device. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * A full-length photo from any phone since about 2015 clears this comfortably. It is set low
 * enough that the check only ever catches a screenshot or a thumbnail — which is exactly what it
 * is for.
 */
export const MIN_WIDTH = 600;
export const MIN_HEIGHT = 900;

/** Below this the frame is landscape or square, and a full outfit will not fit in it. */
const MIN_ASPECT = 1.15;

/** How much of the frame's height the subject must span for "head to feet" to be plausible. */
const MIN_VERTICAL_SPAN = 0.72;

/** Empirical. Photos below this read as soft at a glance. */
const MIN_SHARPNESS = 45;

const MIN_MEAN_LUMA = 42;
const MAX_MEAN_LUMA = 218;

/** Backlight: the border much brighter than the middle means the light is behind her. */
const MAX_BACKLIGHT_RATIO = 1.75;

/** Below this the wall behind her is busy enough to confuse the upstream model. */
const MIN_BACKGROUND_UNIFORMITY = 0.55;

function pass(check: PhotoCheck): PhotoCheckResult {
  return { check, passed: true, messageKey: 'fail' };
}

function fail(
  check: PhotoCheck,
  messageKey = 'fail',
  values?: Record<string, string | number>,
): PhotoCheckResult {
  return { check, passed: false, messageKey, values };
}

/**
 * Decodes with EXIF orientation already applied, so a portrait photo taken sideways is measured
 * the way she sees it rather than the way it is stored. Without this, half of all iPhone photos
 * would fail the aspect check for a reason no one could act on.
 */
export async function decodeImage(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
}

/** Draws the bitmap down to the analysis buffer and reads the pixels back as greyscale. */
function analyse(bitmap: ImageBitmap): GreyImage | null {
  const scale = ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale)));
  const height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;

  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  return toGreyscale(data, width, height);
}

/**
 * Runs every check and returns all of them, passed and failed alike.
 *
 * Every check is reported rather than short-circuiting on the first failure, because two
 * problems in one photo is common — dark *and* soft, usually the same room — and telling her one
 * at a time means three attempts instead of one.
 */
export async function validatePhoto(file: File): Promise<PhotoValidationResult> {
  const results: PhotoCheckResult[] = [];

  const typeAccepted = (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type);
  results.push(
    typeAccepted
      ? pass('SUPPORTED_FORMAT')
      : fail('SUPPORTED_FORMAT', 'fail', { type: file.type || 'unknown' }),
  );

  const sizeOk = file.size <= MAX_SOURCE_BYTES;
  results.push(
    sizeOk
      ? pass('MAX_FILE_SIZE')
      : fail('MAX_FILE_SIZE', 'fail', {
          actual: Math.round((file.size / 1024 / 1024) * 10) / 10,
          max: Math.round(MAX_SOURCE_BYTES / 1024 / 1024),
        }),
  );

  if (!typeAccepted || !sizeOk) {
    return { passed: false, results, dimensions: null };
  }

  const bitmap = await decodeImage(file);
  if (bitmap === null) {
    results.push(fail('DECODE'));
    return { passed: false, results, dimensions: null };
  }
  results.push(pass('DECODE'));

  const { width, height } = bitmap;

  const resolutionOk = width >= MIN_WIDTH && height >= MIN_HEIGHT;
  results.push(
    resolutionOk
      ? pass('MIN_RESOLUTION')
      : fail('MIN_RESOLUTION', 'fail', {
          width,
          height,
          minWidth: MIN_WIDTH,
          minHeight: MIN_HEIGHT,
        }),
  );

  const grey = analyse(bitmap);
  bitmap.close();

  if (grey === null) {
    // No 2D context — a locked-down browser, or a tab under memory pressure. The API still
    // validates, so the upload is allowed through rather than blocked on a check we cannot run.
    return { passed: resolutionOk, results, dimensions: { width, height } };
  }

  // --- framing (C-14 "full-body framing heuristic") ---------------------------------------
  const aspect = height / width;
  const subject = buildSubjectMask(grey);
  const verticalSpan =
    subject.topRow === -1 ? 0 : (subject.bottomRow - subject.topRow + 1) / grey.height;

  if (aspect < MIN_ASPECT) {
    results.push(fail('FULL_BODY_VISIBLE', 'failPortrait'));
  } else if (verticalSpan < MIN_VERTICAL_SPAN) {
    results.push(fail('FULL_BODY_VISIBLE'));
  } else {
    results.push(pass('FULL_BODY_VISIBLE'));
  }

  // --- one person ------------------------------------------------------------------------
  const subjects = countSubjects(subject);
  results.push(subjects > 1 ? fail('SINGLE_SUBJECT') : pass('SINGLE_SUBJECT'));

  // --- sharpness -------------------------------------------------------------------------
  const sharpness = laplacianVariance(grey);
  results.push(sharpness >= MIN_SHARPNESS ? pass('NOT_BLURRY') : fail('NOT_BLURRY'));

  // --- light -----------------------------------------------------------------------------
  const mean = meanLuma(grey);
  const centre = centreLuma(grey);
  const backlit = centre > 0 && mean / centre > MAX_BACKLIGHT_RATIO;

  if (mean < MIN_MEAN_LUMA) {
    results.push(fail('ADEQUATE_LIGHTING', 'failDark'));
  } else if (mean > MAX_MEAN_LUMA || backlit) {
    results.push(fail('ADEQUATE_LIGHTING', 'failBright'));
  } else {
    results.push(pass('ADEQUATE_LIGHTING'));
  }

  // --- background ------------------------------------------------------------------------
  const uniformity = backgroundUniformity(grey);
  results.push(
    uniformity >= MIN_BACKGROUND_UNIFORMITY ? pass('PLAIN_BACKGROUND') : fail('PLAIN_BACKGROUND'),
  );

  return {
    passed: results.every((result) => result.passed),
    results,
    dimensions: { width, height },
  };
}
