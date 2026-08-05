import {
  ALLOWED_PHOTO_FORMATS,
  MAX_PHOTO_ASPECT_RATIO,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_LONG_EDGE_PX,
  MIN_PHOTO_ASPECT_RATIO,
  MIN_PHOTO_LONG_EDGE_PX,
  MIN_PHOTO_SHORT_EDGE_PX,
} from '../constants/person-photo.constants';

/**
 * The server-side person-photo checks (PRD C-14), as **pure functions**.
 *
 * They take numbers and return verdicts. No repository, no storage, no `sharp` — the
 * caller has already probed the bytes and hands the measurements over. That is what
 * makes E-5 ("unit coverage of … image validation rules") cheap: every branch below is
 * reachable from a plain object literal, and the awkward cases — a 799px long edge, a
 * square frame, a landscape frame one pixel outside the band — are all one line each.
 *
 * The checks are evaluated **together**, never short-circuited. A consumer who
 * uploads a small landscape photograph should be told both things at once; making her
 * discover the second problem by fixing the first is the "rejections are specific and
 * actionable" half of C-14 failing.
 */

/** The identifiers surfaced in `PHOTO_VALIDATION_FAILED.details.checks[]` (C-14). */
export const PHOTO_CHECKS = {
  FORMAT: 'FORMAT',
  LONG_EDGE: 'LONG_EDGE',
  SHORT_EDGE: 'SHORT_EDGE',
  ASPECT_RATIO: 'ASPECT_RATIO',
  BYTE_SIZE: 'BYTE_SIZE',
} as const;

export type PhotoCheckName = (typeof PHOTO_CHECKS)[keyof typeof PHOTO_CHECKS];

/** What the caller measured from the stored bytes. */
export interface PhotoMeasurements {
  readonly width: number;
  readonly height: number;
  /** As reported by `sharp` — `jpeg`, `png`, `webp`, `heif`, … */
  readonly format: string;
  readonly byteSize: number;
}

/** One failed check, ready to travel in `details.checks[]`. */
export interface PhotoCheckFailure {
  readonly check: PhotoCheckName;
  /** Client-safe, specific and actionable (C-14). Never names a storage key. */
  readonly message: string;
  readonly actual: number | string;
  readonly expected: string;
}

export interface PhotoValidationResult {
  readonly passed: boolean;
  readonly failures: readonly PhotoCheckFailure[];
  readonly longEdgePx: number;
  readonly shortEdgePx: number;
  /** `width / height`, rounded to three places so an assertion can be written honestly. */
  readonly aspectRatio: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** true when `sharp` reported a container we are willing to store. */
export function isAllowedPhotoFormat(format: string): boolean {
  return ALLOWED_PHOTO_FORMATS.includes(format.toLowerCase());
}

/**
 * Runs every check and reports all of them.
 *
 * A zero or negative dimension is treated as a long-edge failure rather than a
 * division by zero: `sharp` reports `0` for a file it could open but could not
 * measure, and that is a corrupt photograph, not a crash.
 */
export function validatePersonPhoto(measurements: PhotoMeasurements): PhotoValidationResult {
  const { width, height, format, byteSize } = measurements;
  const longEdgePx = Math.max(width, height);
  const shortEdgePx = Math.min(width, height);
  const aspectRatio = height > 0 ? round3(width / height) : 0;

  const failures: PhotoCheckFailure[] = [];

  if (!isAllowedPhotoFormat(format)) {
    failures.push({
      check: PHOTO_CHECKS.FORMAT,
      message: 'We accept HEIC, WebP, PNG and JPEG.',
      actual: format,
      expected: ALLOWED_PHOTO_FORMATS.join(', '),
    });
  }

  if (longEdgePx < MIN_PHOTO_LONG_EDGE_PX) {
    failures.push({
      check: PHOTO_CHECKS.LONG_EDGE,
      message: `This photo is ${longEdgePx}px on its longest side. It needs at least ${MIN_PHOTO_LONG_EDGE_PX}px.`,
      actual: longEdgePx,
      expected: `>= ${MIN_PHOTO_LONG_EDGE_PX}px`,
    });
  } else if (longEdgePx > MAX_PHOTO_LONG_EDGE_PX) {
    failures.push({
      check: PHOTO_CHECKS.LONG_EDGE,
      message: 'That photo is unusually large. Export it again at a normal size.',
      actual: longEdgePx,
      expected: `<= ${MAX_PHOTO_LONG_EDGE_PX}px`,
    });
  }

  if (shortEdgePx < MIN_PHOTO_SHORT_EDGE_PX) {
    failures.push({
      check: PHOTO_CHECKS.SHORT_EDGE,
      message: `This photo is ${shortEdgePx}px on its shortest side. It needs at least ${MIN_PHOTO_SHORT_EDGE_PX}px.`,
      actual: shortEdgePx,
      expected: `>= ${MIN_PHOTO_SHORT_EDGE_PX}px`,
    });
  }

  if (aspectRatio < MIN_PHOTO_ASPECT_RATIO || aspectRatio > MAX_PHOTO_ASPECT_RATIO) {
    failures.push({
      check: PHOTO_CHECKS.ASPECT_RATIO,
      message: 'A full-body photo works best held upright, taller than it is wide.',
      actual: aspectRatio,
      expected: `${MIN_PHOTO_ASPECT_RATIO}–${MAX_PHOTO_ASPECT_RATIO}`,
    });
  }

  if (byteSize > MAX_PHOTO_BYTES) {
    failures.push({
      check: PHOTO_CHECKS.BYTE_SIZE,
      message: `That file is over ${Math.round(MAX_PHOTO_BYTES / (1024 * 1024))}MB. Try a smaller one.`,
      actual: byteSize,
      expected: `<= ${MAX_PHOTO_BYTES} bytes`,
    });
  }

  return { passed: failures.length === 0, failures, longEdgePx, shortEdgePx, aspectRatio };
}
