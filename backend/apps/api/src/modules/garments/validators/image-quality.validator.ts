/**
 * PRD A-10 — try-on source image quality validation.
 *
 * Everything in this file is a **pure function of numbers**. `ImageService.probeQuality()`
 * measures (§3.6) and deliberately scores nothing; this is where the measurements become a
 * score, a pass/fail per check, and the remediation copy an admin acts on. Nothing here reads a
 * file, touches a repository, or knows what a `Garment` is — which is what lets E-5 test all
 * five checks at, just above and just below their thresholds against synthetic inputs, with no
 * image on disk and no database anywhere.
 *
 * Copy standard (PRD §10.5, D-7): every remediation string is active voice, sentence case, and
 * says what to do next. None of them apologise and none of them blame the photographer. They
 * carry the measured number, because "make it bigger" is not guidance and "1,640px — it needs
 * 2000px" is.
 */
import type { ImageQualityMeasurements } from '@library/storage';

import {
  IMAGE_QUALITY_THRESHOLDS,
  QUALITY_CHECK_ORDER,
  QUALITY_CHECK_WEIGHTS,
  QUALITY_CHECKS,
  QUALITY_VERDICTS,
  type QualityCheckId,
  type QualityVerdict,
} from './image-quality.constants';

/**
 * One check's outcome. Structurally identical to `QualityCheckResult` (§4.13) so a report can
 * be written straight onto `garments.qualityChecks` without a second shape to keep in step.
 */
export interface QualityCheckOutcome {
  readonly check: QualityCheckId;
  readonly passed: boolean;
  /** Contribution to the 0–100 score: the check's full weight, or zero. */
  readonly score: number;
  /** What to do next. `null` when the check passed. */
  readonly remediation: string | null;
}

/** The whole A-10 verdict for one image. */
export interface ImageQualityReport {
  /** 0–100. Persisted as `garments.qualityScore`. */
  readonly score: number;
  /** The pass mark this report was judged against — `quality.minScore` (§4.28). */
  readonly minScore: number;
  /** `score >= minScore`. */
  readonly passed: boolean;
  /** `NEEDS_BETTER_PHOTO` is A-10's "Needs a better photo". */
  readonly verdict: QualityVerdict;
  /** Every check, in `QUALITY_CHECK_ORDER`. Persisted as `garments.qualityChecks`. */
  readonly checks: readonly QualityCheckOutcome[];
}

export interface EvaluateImageQualityOptions {
  /** Defaults to `IMAGE_QUALITY_THRESHOLDS.DEFAULT_MIN_SCORE`, which mirrors the registry. */
  readonly minScore?: number;
}

/* -------------------------------------------------------------------------------------------------
 * Formatting helpers — shared so two messages can never disagree about how a number reads
 * ---------------------------------------------------------------------------------------------- */

function px(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')}px`;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/* -------------------------------------------------------------------------------------------------
 * The five checks (A-10)
 * ---------------------------------------------------------------------------------------------- */

/** A-10: "minimum 2000px on the long edge". */
export function checkLongEdge(measurements: ImageQualityMeasurements): QualityCheckOutcome {
  const required = IMAGE_QUALITY_THRESHOLDS.MIN_LONG_EDGE_PX;
  const passed = measurements.longEdgePx >= required;

  return outcome(
    QUALITY_CHECKS.LONG_EDGE,
    passed,
    `Re-export this piece at ${px(required)} or more on its longest side. ` +
      `This one is ${px(measurements.longEdgePx)}.`,
  );
}

/**
 * A-10: "single dominant garment detected".
 *
 * Four ways to fail, reported in a fixed order so the same measurements always produce the same
 * sentence: the piece is too small in frame, it fills the frame with no background left, the
 * frame holds more than one thing, or the piece is pushed off to one side.
 */
export function checkDominantGarment(measurements: ImageQualityMeasurements): QualityCheckOutcome {
  const {
    MIN_SUBJECT_PIXEL_RATIO,
    MAX_SUBJECT_PIXEL_RATIO,
    MAX_SUBJECT_SPREAD,
    MAX_SUBJECT_CENTROID_OFFSET,
  } = IMAGE_QUALITY_THRESHOLDS;

  const subject = measurements.subjectPixelRatio;
  // A subject of zero area has no meaningful spread; treat it as infinitely spread so the
  // "too small" branch below is the one that speaks, rather than a division by zero.
  const spread =
    subject > 0 ? measurements.subjectBoundingBoxRatio / subject : Number.POSITIVE_INFINITY;
  const offset = Math.max(
    Math.abs(measurements.subjectCentroidOffset.x),
    Math.abs(measurements.subjectCentroidOffset.y),
  );

  if (subject < MIN_SUBJECT_PIXEL_RATIO) {
    return outcome(
      QUALITY_CHECKS.DOMINANT_GARMENT,
      false,
      `Move in closer so the piece fills the frame. It covers ${percent(subject)} of this photo; ` +
        `aim for ${percent(MIN_SUBJECT_PIXEL_RATIO)} or more.`,
    );
  }

  if (subject > MAX_SUBJECT_PIXEL_RATIO) {
    return outcome(
      QUALITY_CHECKS.DOMINANT_GARMENT,
      false,
      `Leave a margin of plain backdrop around the piece. It covers ${percent(subject)} of this ` +
        `photo, so there is no background left to separate it from.`,
    );
  }

  if (spread > MAX_SUBJECT_SPREAD) {
    return outcome(
      QUALITY_CHECKS.DOMINANT_GARMENT,
      false,
      'Shoot one piece on its own. This frame holds more than one subject — move the other ' +
        'garments and props out of shot.',
    );
  }

  if (offset > MAX_SUBJECT_CENTROID_OFFSET) {
    return outcome(
      QUALITY_CHECKS.DOMINANT_GARMENT,
      false,
      'Centre the piece in the frame. It sits well to one side of this photo.',
    );
  }

  return outcome(QUALITY_CHECKS.DOMINANT_GARMENT, true, null);
}

/** A-10: "background uniformity". */
export function checkBackgroundUniformity(
  measurements: ImageQualityMeasurements,
): QualityCheckOutcome {
  const required = IMAGE_QUALITY_THRESHOLDS.MIN_BACKGROUND_UNIFORMITY;
  const passed = measurements.backgroundUniformity >= required;

  return outcome(
    QUALITY_CHECKS.BACKGROUND_UNIFORMITY,
    passed,
    'Shoot against one plain, evenly lit backdrop so the piece separates cleanly from it. ' +
      `This background scores ${percent(measurements.backgroundUniformity)} for evenness; ` +
      `${percent(required)} is the mark.`,
  );
}

/** A-10: "aspect ratio within band". */
export function checkAspectRatio(measurements: ImageQualityMeasurements): QualityCheckOutcome {
  const { MIN_ASPECT_RATIO, MAX_ASPECT_RATIO } = IMAGE_QUALITY_THRESHOLDS;
  const ratio = measurements.aspectRatio;
  const passed = ratio >= MIN_ASPECT_RATIO && ratio <= MAX_ASPECT_RATIO;

  return outcome(
    QUALITY_CHECKS.ASPECT_RATIO,
    passed,
    'Crop this to an upright frame between 3:5 and square. ' +
      `This one is ${px(measurements.width)} by ${px(measurements.height)}.`,
  );
}

/** A-10: "accepted format — HEIC, WebP, PNG, JPEG". */
export function checkFormat(measurements: ImageQualityMeasurements): QualityCheckOutcome {
  const passed = IMAGE_QUALITY_THRESHOLDS.ACCEPTED_FORMATS.includes(
    measurements.format.trim().toLowerCase(),
  );

  return outcome(QUALITY_CHECKS.FORMAT, passed, 'Export this piece as JPEG, PNG, WebP or HEIC.');
}

/* -------------------------------------------------------------------------------------------------
 * The aggregate
 * ---------------------------------------------------------------------------------------------- */

const CHECKERS: Readonly<
  Record<QualityCheckId, (measurements: ImageQualityMeasurements) => QualityCheckOutcome>
> = {
  [QUALITY_CHECKS.LONG_EDGE]: checkLongEdge,
  [QUALITY_CHECKS.DOMINANT_GARMENT]: checkDominantGarment,
  [QUALITY_CHECKS.BACKGROUND_UNIFORMITY]: checkBackgroundUniformity,
  [QUALITY_CHECKS.ASPECT_RATIO]: checkAspectRatio,
  [QUALITY_CHECKS.FORMAT]: checkFormat,
};

/**
 * Runs all five A-10 checks and produces the score, the verdict and the remediation guidance.
 *
 * Deterministic by construction: same measurements in, byte-identical report out. There is no
 * clock, no randomness, no I/O and no hidden state — the only input beyond the measurements is
 * the pass mark, and the caller supplies that from `quality.minScore` so a studio can move the
 * bar without a deploy (§4.28).
 */
export function evaluateImageQuality(
  measurements: ImageQualityMeasurements,
  options: EvaluateImageQualityOptions = {},
): ImageQualityReport {
  const minScore = normaliseMinScore(options.minScore);
  const checks = QUALITY_CHECK_ORDER.map((check) => CHECKERS[check](measurements));
  const score = checks.reduce((total, check) => total + check.score, 0);
  const passed = score >= minScore;

  return {
    score,
    minScore,
    passed,
    verdict: passed ? QUALITY_VERDICTS.READY : QUALITY_VERDICTS.NEEDS_BETTER_PHOTO,
    checks,
  };
}

/** The failing checks only — what the `GARMENT_QUALITY_BELOW_THRESHOLD` `details.checks[]` carries. */
export function failedChecks(report: ImageQualityReport): readonly QualityCheckOutcome[] {
  return report.checks.filter((check) => !check.passed);
}

/**
 * `true` when a garment carrying this score may be published without an override.
 *
 * §4.13's publish state machine: "`DRAFT → PUBLISHED` requires … either
 * `qualityScore ≥ QUALITY_MIN_SCORE` or an explicit override". A garment with **no** score has
 * never had a try-on source validated, so it is not publishable either — the caller reports
 * that as `TRYON_SOURCE_REQUIRED`, not as a quality failure.
 */
export function meetsQualityBar(score: number | null, minScore: number): boolean {
  return score !== null && score >= minScore;
}

/* -------------------------------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------------------------------- */

/** A check is worth its full weight or nothing — see `QUALITY_CHECK_WEIGHTS` for why. */
function outcome(
  check: QualityCheckId,
  passed: boolean,
  remediation: string | null,
): QualityCheckOutcome {
  return {
    check,
    passed,
    score: passed ? QUALITY_CHECK_WEIGHTS[check] : 0,
    remediation: passed ? null : remediation,
  };
}

/**
 * A pass mark outside 0–100 cannot mean anything, and a stored setting is only validated as "a
 * number" (§4.28). Clamp rather than throw: a hand-edited row must not be able to stop every
 * admin publishing.
 */
function normaliseMinScore(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return IMAGE_QUALITY_THRESHOLDS.DEFAULT_MIN_SCORE;
  }
  return Math.min(100, Math.max(0, Math.round(requested)));
}
