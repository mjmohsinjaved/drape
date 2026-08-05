/**
 * PRD A-10 — the try-on source quality thresholds, in **one** place.
 *
 * A-10 names five checks and one verdict:
 *
 * > minimum 2000px on the long edge · single dominant garment detected · background
 * > uniformity · aspect ratio within band · accepted format — HEIC, WebP, PNG, JPEG.
 * > Below threshold the garment is marked **Needs a better photo** and cannot be published
 * > without an explicit override, which is logged.
 *
 * Only the **pass mark** is tunable at runtime: `SETTINGS_REGISTRY` carries
 * `quality.minScore` (default 70, ARCHITECTURE §4.28) and `ImageQualityService` reads it, so
 * a studio can move the bar without a deploy. The per-check thresholds below are *what the
 * upstream model needs to work at all* rather than a matter of taste, so they are code, not
 * configuration — and they live here rather than being spelled inline at five call sites, so
 * "what does Drape consider a usable garment photo" has exactly one answer.
 *
 * Nothing in this file imports anything. The validator that consumes it is pure, which is what
 * lets E-5 test the scoring against synthetic measurements with no image on disk.
 */

/** The closed set of A-10 checks. Stored on `garments.qualityChecks[].check` (§4.13). */
export const QUALITY_CHECKS = {
  /** A-10: "minimum 2000px on the long edge". */
  LONG_EDGE: 'LONG_EDGE',
  /** A-10: "single dominant garment detected". */
  DOMINANT_GARMENT: 'DOMINANT_GARMENT',
  /** A-10: "background uniformity". */
  BACKGROUND_UNIFORMITY: 'BACKGROUND_UNIFORMITY',
  /** A-10: "aspect ratio within band". */
  ASPECT_RATIO: 'ASPECT_RATIO',
  /** A-10: "accepted format — HEIC, WebP, PNG, JPEG". */
  FORMAT: 'FORMAT',
} as const;

export type QualityCheckId = (typeof QUALITY_CHECKS)[keyof typeof QUALITY_CHECKS];

/** Every check, in the order they are reported and scored. */
export const QUALITY_CHECK_ORDER: readonly QualityCheckId[] = [
  QUALITY_CHECKS.LONG_EDGE,
  QUALITY_CHECKS.DOMINANT_GARMENT,
  QUALITY_CHECKS.BACKGROUND_UNIFORMITY,
  QUALITY_CHECKS.ASPECT_RATIO,
  QUALITY_CHECKS.FORMAT,
];

/**
 * How much of the 0–100 score each check carries. They sum to exactly 100 — asserted by a unit
 * test, because a silent drift here would move the effective pass mark for every garment
 * without anybody editing `quality.minScore`.
 *
 * **A check is worth its full weight or nothing.** Partial credit sounds kinder and is worse:
 * a 1999px image would score 31 of 32 on the long edge and sail past the pass mark, which is
 * precisely the outcome A-10's "minimum 2000px" exists to prevent.
 *
 * The numbers are chosen so the arithmetic says what the product means at the default pass
 * mark of 70 (§4.28):
 *
 *  - failing **`LONG_EDGE`** alone scores 68 — below the bar. Resolution is what the upstream
 *    model consumes; there is no recovering from it downstream.
 *  - failing **`DOMINANT_GARMENT`** alone scores 68 — below the bar. Two pieces in frame is the
 *    single most common cause of `UPSTREAM_NO_GARMENT_DETECTED` (§8.3).
 *  - failing any one of the three qualitative checks leaves the garment publishable but
 *    visibly marked down, and failing two of them drops it to the bar or below.
 *  - `FORMAT` is the lightest because a rejected format never reaches scoring at all: the
 *    upload is refused with `IMAGE_FORMAT_UNSUPPORTED` (415) long before this runs.
 */
export const QUALITY_CHECK_WEIGHTS: Readonly<Record<QualityCheckId, number>> = {
  [QUALITY_CHECKS.LONG_EDGE]: 32,
  [QUALITY_CHECKS.DOMINANT_GARMENT]: 32,
  [QUALITY_CHECKS.BACKGROUND_UNIFORMITY]: 18,
  [QUALITY_CHECKS.ASPECT_RATIO]: 12,
  [QUALITY_CHECKS.FORMAT]: 6,
};

export const QUALITY_TOTAL_WEIGHT = 100;

/**
 * The thresholds themselves.
 *
 * `ImageService.probeQuality()` reports the raw measurements and deliberately scores nothing
 * (§3.6); every judgement about those numbers is made against a constant declared here.
 */
export const IMAGE_QUALITY_THRESHOLDS = {
  /** A-10, verbatim: 2000px on the long edge. */
  MIN_LONG_EDGE_PX: 2000,

  /**
   * `backgroundUniformity` is `1` when every sampled border pixel is the same colour. A studio
   * sweep or a plain wall sits comfortably above `0.8`; a room with furniture in it does not.
   */
  MIN_BACKGROUND_UNIFORMITY: 0.8,

  /**
   * "Single dominant garment", part one — the subject has to be *there* and has to be
   * *dominant*. Below 15 % of the frame the piece is a speck the model cannot work from; above
   * 90 % there is no background left to separate it from.
   */
  MIN_SUBJECT_PIXEL_RATIO: 0.15,
  MAX_SUBJECT_PIXEL_RATIO: 0.9,

  /**
   * Part two — `subjectBoundingBoxRatio / subjectPixelRatio`. One garment fills most of its own
   * bounding box, so the ratio stays near 1. Two pieces side by side, or a piece plus props,
   * stretch the box across empty frame and push the ratio up. `2.0` is the point at which half
   * of what the box encloses is not garment.
   */
  MAX_SUBJECT_SPREAD: 2.0,

  /**
   * Part three — how far the subject's centroid may sit from the centre of the frame, per axis,
   * on the `-1`–`1` scale `probeQuality()` reports. A single centred piece stays well inside
   * `0.35`; scattered clutter drags the centroid off-centre.
   */
  MAX_SUBJECT_CENTROID_OFFSET: 0.35,

  /**
   * "Aspect ratio within band" — `width / height`. Garments are shot upright: 3:5 (`0.6`) is the
   * tallest useful frame, 1:1 the widest. A landscape photograph of a lehenga is a photograph of
   * a room with a lehenga in it.
   */
  MIN_ASPECT_RATIO: 0.6,
  MAX_ASPECT_RATIO: 1.0,

  /**
   * A-10: "accepted format — HEIC, WebP, PNG, JPEG". These are `sharp`'s own format names, which
   * is what `ImageQualityMeasurements.format` carries. `heif` is the container name sharp
   * reports for a `.heic` file, so both spellings are accepted.
   */
  ACCEPTED_FORMATS: ['jpeg', 'jpg', 'png', 'webp', 'heic', 'heif'] as readonly string[],

  /**
   * Fallback pass mark, used only when `quality.minScore` cannot be read. Identical to the
   * registry default (§4.28) so the two can never disagree about where the bar is.
   */
  DEFAULT_MIN_SCORE: 70,
} as const;

/**
 * The A-10 verdict.
 *
 * `NEEDS_BETTER_PHOTO` is the state A-10 calls **"Needs a better photo"**: the garment keeps its
 * images, keeps its draft, and cannot be published without an audited override.
 */
export const QUALITY_VERDICTS = {
  READY: 'READY',
  NEEDS_BETTER_PHOTO: 'NEEDS_BETTER_PHOTO',
} as const;

export type QualityVerdict = (typeof QUALITY_VERDICTS)[keyof typeof QUALITY_VERDICTS];

/**
 * The label an admin sees, taken from A-10 word for word. Exported so the web app and the API
 * cannot drift apart on the one string the requirement actually names.
 */
export const NEEDS_BETTER_PHOTO_LABEL = 'Needs a better photo';
