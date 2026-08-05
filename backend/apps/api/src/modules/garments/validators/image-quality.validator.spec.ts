/**
 * PRD A-10 / E-5 — the try-on source quality scoring.
 *
 * Every check is exercised **at, just above and just below** its threshold, plus the aggregate
 * score, the verdict and the remediation string for each failure mode. No image is decoded and
 * no `sharp` call is made: `ImageService.probeQuality()` measures, this validator judges, and
 * the seam between them is a plain object of numbers.
 */
import type { ImageQualityMeasurements } from '@library/storage';

import {
  IMAGE_QUALITY_THRESHOLDS,
  NEEDS_BETTER_PHOTO_LABEL,
  QUALITY_CHECK_ORDER,
  QUALITY_CHECK_WEIGHTS,
  QUALITY_CHECKS,
  QUALITY_TOTAL_WEIGHT,
  QUALITY_VERDICTS,
} from './image-quality.constants';
import { framedMeasurements, measurements } from './image-quality.fixtures';
import {
  checkAspectRatio,
  checkBackgroundUniformity,
  checkDominantGarment,
  checkFormat,
  checkLongEdge,
  evaluateImageQuality,
  failedChecks,
  meetsQualityBar,
} from './image-quality.validator';

const {
  MIN_LONG_EDGE_PX,
  MIN_BACKGROUND_UNIFORMITY,
  MIN_SUBJECT_PIXEL_RATIO,
  MAX_SUBJECT_PIXEL_RATIO,
  MAX_SUBJECT_SPREAD,
  MAX_SUBJECT_CENTROID_OFFSET,
  MIN_ASPECT_RATIO,
  MAX_ASPECT_RATIO,
  DEFAULT_MIN_SCORE,
} = IMAGE_QUALITY_THRESHOLDS;

/** Measurements with a bounding box that produces exactly `spread` for the given subject area. */
function withSpread(subjectPixelRatio: number, spread: number): ImageQualityMeasurements {
  return measurements({
    subjectPixelRatio,
    subjectBoundingBoxRatio: subjectPixelRatio * spread,
  });
}

describe('image quality constants (A-10)', () => {
  it('weights every check and sums to exactly 100', () => {
    const total = QUALITY_CHECK_ORDER.reduce((sum, check) => sum + QUALITY_CHECK_WEIGHTS[check], 0);

    expect(QUALITY_CHECK_ORDER).toHaveLength(5);
    expect(new Set(QUALITY_CHECK_ORDER).size).toBe(5);
    expect(total).toBe(QUALITY_TOTAL_WEIGHT);
    expect(total).toBe(100);
  });

  it('keeps the fallback pass mark identical to the settings-registry default', () => {
    // `quality.minScore` in SETTINGS_REGISTRY defaults to 70 (§4.28). If the two ever disagree,
    // an unreadable setting silently moves the bar.
    expect(DEFAULT_MIN_SCORE).toBe(70);
  });

  it('names the A-10 label word for word', () => {
    expect(NEEDS_BETTER_PHOTO_LABEL).toBe('Needs a better photo');
  });
});

describe('checkLongEdge — "minimum 2000px on the long edge"', () => {
  it('passes at the threshold', () => {
    const outcome = checkLongEdge(framedMeasurements(1600, MIN_LONG_EDGE_PX));

    expect(outcome.passed).toBe(true);
    expect(outcome.score).toBe(QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.LONG_EDGE]);
    expect(outcome.remediation).toBeNull();
  });

  it('passes just above the threshold', () => {
    expect(checkLongEdge(framedMeasurements(1600, MIN_LONG_EDGE_PX + 1)).passed).toBe(true);
  });

  it('fails just below the threshold and scores nothing', () => {
    const outcome = checkLongEdge(framedMeasurements(1600, MIN_LONG_EDGE_PX - 1));

    expect(outcome.passed).toBe(false);
    expect(outcome.score).toBe(0);
  });

  it('names the required size and the measured size in the remediation', () => {
    const outcome = checkLongEdge(framedMeasurements(1312, 1640));

    expect(outcome.remediation).toBe(
      'Re-export this piece at 2,000px or more on its longest side. This one is 1,640px.',
    );
  });
});

describe('checkDominantGarment — "single dominant garment detected"', () => {
  it('passes at the lower subject-area threshold', () => {
    const outcome = checkDominantGarment(withSpread(MIN_SUBJECT_PIXEL_RATIO, 1.4));

    expect(outcome.passed).toBe(true);
    expect(outcome.score).toBe(QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.DOMINANT_GARMENT]);
  });

  it('passes just above the lower subject-area threshold', () => {
    expect(checkDominantGarment(withSpread(MIN_SUBJECT_PIXEL_RATIO + 0.01, 1.4)).passed).toBe(true);
  });

  it('fails just below the lower subject-area threshold, telling the admin to move closer', () => {
    const outcome = checkDominantGarment(withSpread(MIN_SUBJECT_PIXEL_RATIO - 0.01, 1.4));

    expect(outcome.passed).toBe(false);
    expect(outcome.score).toBe(0);
    expect(outcome.remediation).toBe(
      'Move in closer so the piece fills the frame. It covers 14% of this photo; aim for 15% or more.',
    );
  });

  it('passes at the upper subject-area threshold', () => {
    expect(checkDominantGarment(withSpread(MAX_SUBJECT_PIXEL_RATIO, 1.05)).passed).toBe(true);
  });

  it('fails just above the upper subject-area threshold, asking for a margin of backdrop', () => {
    const outcome = checkDominantGarment(withSpread(MAX_SUBJECT_PIXEL_RATIO + 0.01, 1.05));

    expect(outcome.passed).toBe(false);
    expect(outcome.remediation).toBe(
      'Leave a margin of plain backdrop around the piece. It covers 91% of this photo, so there ' +
        'is no background left to separate it from.',
    );
  });

  it('passes at the spread threshold', () => {
    expect(checkDominantGarment(withSpread(0.4, MAX_SUBJECT_SPREAD)).passed).toBe(true);
  });

  it('fails just above the spread threshold — more than one subject in frame', () => {
    const outcome = checkDominantGarment(withSpread(0.4, MAX_SUBJECT_SPREAD + 0.01));

    expect(outcome.passed).toBe(false);
    expect(outcome.remediation).toBe(
      'Shoot one piece on its own. This frame holds more than one subject — move the other ' +
        'garments and props out of shot.',
    );
  });

  it('passes at the centroid-offset threshold', () => {
    const outcome = checkDominantGarment(
      measurements({ subjectCentroidOffset: { x: MAX_SUBJECT_CENTROID_OFFSET, y: 0 } }),
    );

    expect(outcome.passed).toBe(true);
  });

  it('fails just above the centroid-offset threshold, on either axis', () => {
    const offset = MAX_SUBJECT_CENTROID_OFFSET + 0.01;

    for (const centroid of [
      { x: offset, y: 0 },
      { x: 0, y: -offset },
    ]) {
      const outcome = checkDominantGarment(measurements({ subjectCentroidOffset: centroid }));

      expect(outcome.passed).toBe(false);
      expect(outcome.remediation).toBe(
        'Centre the piece in the frame. It sits well to one side of this photo.',
      );
    }
  });

  it('reports an empty frame as "too small" rather than dividing by zero', () => {
    const outcome = checkDominantGarment(
      measurements({ subjectPixelRatio: 0, subjectBoundingBoxRatio: 0 }),
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.remediation).toContain('Move in closer');
  });

  it('reports the failures in a fixed order, so identical input gives identical copy', () => {
    // Too small AND badly spread AND off-centre: "too small" is the one that speaks.
    const outcome = checkDominantGarment(
      measurements({
        subjectPixelRatio: 0.02,
        subjectBoundingBoxRatio: 0.9,
        subjectCentroidOffset: { x: 0.8, y: 0.8 },
      }),
    );

    expect(outcome.remediation).toContain('Move in closer');
  });
});

describe('checkBackgroundUniformity — "background uniformity"', () => {
  it('passes at the threshold', () => {
    const outcome = checkBackgroundUniformity(
      measurements({ backgroundUniformity: MIN_BACKGROUND_UNIFORMITY }),
    );

    expect(outcome.passed).toBe(true);
    expect(outcome.score).toBe(QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.BACKGROUND_UNIFORMITY]);
  });

  it('passes just above the threshold', () => {
    expect(
      checkBackgroundUniformity(
        measurements({ backgroundUniformity: MIN_BACKGROUND_UNIFORMITY + 0.01 }),
      ).passed,
    ).toBe(true);
  });

  it('fails just below the threshold and says what to change', () => {
    const outcome = checkBackgroundUniformity(measurements({ backgroundUniformity: 0.42 }));

    expect(outcome.passed).toBe(false);
    expect(outcome.score).toBe(0);
    expect(outcome.remediation).toBe(
      'Shoot against one plain, evenly lit backdrop so the piece separates cleanly from it. ' +
        'This background scores 42% for evenness; 80% is the mark.',
    );
  });
});

describe('checkAspectRatio — "aspect ratio within band"', () => {
  it('passes at both edges of the band', () => {
    expect(checkAspectRatio(measurements({ aspectRatio: MIN_ASPECT_RATIO })).passed).toBe(true);
    expect(checkAspectRatio(measurements({ aspectRatio: MAX_ASPECT_RATIO })).passed).toBe(true);
  });

  it('passes just inside both edges', () => {
    expect(checkAspectRatio(measurements({ aspectRatio: MIN_ASPECT_RATIO + 0.01 })).passed).toBe(
      true,
    );
    expect(checkAspectRatio(measurements({ aspectRatio: MAX_ASPECT_RATIO - 0.01 })).passed).toBe(
      true,
    );
  });

  it('fails just outside both edges', () => {
    expect(checkAspectRatio(measurements({ aspectRatio: MIN_ASPECT_RATIO - 0.01 })).passed).toBe(
      false,
    );
    expect(checkAspectRatio(measurements({ aspectRatio: MAX_ASPECT_RATIO + 0.01 })).passed).toBe(
      false,
    );
  });

  it('names the frame it measured in the remediation', () => {
    const outcome = checkAspectRatio(framedMeasurements(4000, 2250));

    expect(outcome.score).toBe(0);
    expect(outcome.remediation).toBe(
      'Crop this to an upright frame between 3:5 and square. This one is 4,000px by 2,250px.',
    );
  });
});

describe('checkFormat — "accepted format: HEIC, WebP, PNG, JPEG"', () => {
  it.each(['jpeg', 'jpg', 'png', 'webp', 'heic', 'heif'])('accepts %s', (format) => {
    const outcome = checkFormat(measurements({ format }));

    expect(outcome.passed).toBe(true);
    expect(outcome.score).toBe(QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.FORMAT]);
  });

  it('accepts the accepted formats however they are cased', () => {
    expect(checkFormat(measurements({ format: ' JPEG ' })).passed).toBe(true);
  });

  it.each(['gif', 'tiff', 'svg', 'bmp', 'avif', 'pdf', ''])('rejects %s', (format) => {
    const outcome = checkFormat(measurements({ format }));

    expect(outcome.passed).toBe(false);
    expect(outcome.score).toBe(0);
    expect(outcome.remediation).toBe('Export this piece as JPEG, PNG, WebP or HEIC.');
  });
});

describe('evaluateImageQuality — the aggregate (A-10)', () => {
  it('scores a clean photograph 100 and calls it ready', () => {
    const report = evaluateImageQuality(measurements());

    expect(report.score).toBe(100);
    expect(report.passed).toBe(true);
    expect(report.verdict).toBe(QUALITY_VERDICTS.READY);
    expect(failedChecks(report)).toHaveLength(0);
    expect(report.checks.every((check) => check.remediation === null)).toBe(true);
  });

  it('reports every check, once, in a stable order', () => {
    const report = evaluateImageQuality(measurements());

    expect(report.checks.map((check) => check.check)).toEqual([...QUALITY_CHECK_ORDER]);
  });

  it('is deterministic — identical measurements produce an identical report', () => {
    const input = framedMeasurements(1200, 1500, { backgroundUniformity: 0.31, format: 'gif' });

    expect(evaluateImageQuality(input)).toStrictEqual(evaluateImageQuality(input));
  });

  it('drops a low-resolution photograph below the default bar on that check alone', () => {
    // 32 of 100 lost. A-10's hard minimum has to bite by itself, not only in company.
    const report = evaluateImageQuality(framedMeasurements(1200, 1500));

    expect(report.score).toBe(100 - QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.LONG_EDGE]);
    expect(report.score).toBeLessThan(DEFAULT_MIN_SCORE);
    expect(report.passed).toBe(false);
    expect(report.verdict).toBe(QUALITY_VERDICTS.NEEDS_BETTER_PHOTO);
  });

  it('drops a cluttered photograph below the default bar on that check alone', () => {
    const report = evaluateImageQuality(withSpread(0.5, 3.2));

    expect(report.score).toBe(100 - QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.DOMINANT_GARMENT]);
    expect(report.passed).toBe(false);
  });

  it('marks a single qualitative failure down without blocking publication', () => {
    const report = evaluateImageQuality(measurements({ backgroundUniformity: 0.5 }));

    expect(report.score).toBe(100 - QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.BACKGROUND_UNIFORMITY]);
    expect(report.score).toBeGreaterThanOrEqual(DEFAULT_MIN_SCORE);
    expect(report.passed).toBe(true);
  });

  it('blocks when two qualitative checks fail together', () => {
    const report = evaluateImageQuality(
      measurements({ backgroundUniformity: 0.5, aspectRatio: 1.8, format: 'gif' }),
    );

    expect(report.score).toBe(
      100 -
        QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.BACKGROUND_UNIFORMITY] -
        QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.ASPECT_RATIO] -
        QUALITY_CHECK_WEIGHTS[QUALITY_CHECKS.FORMAT],
    );
    expect(report.passed).toBe(false);
  });

  it('scores nothing when every check fails, and carries five remediation strings', () => {
    const report = evaluateImageQuality(
      measurements({
        width: 400,
        height: 200,
        longEdgePx: 400,
        shortEdgePx: 200,
        aspectRatio: 2,
        format: 'gif',
        backgroundUniformity: 0.1,
        subjectPixelRatio: 0.01,
        subjectBoundingBoxRatio: 0.95,
      }),
    );

    expect(report.score).toBe(0);
    expect(failedChecks(report)).toHaveLength(5);
    expect(
      failedChecks(report).every(
        (check) => typeof check.remediation === 'string' && check.remediation.length > 0,
      ),
    ).toBe(true);
  });

  it('judges against the supplied pass mark, so quality.minScore can be tuned without a deploy', () => {
    const marginal = measurements({ backgroundUniformity: 0.5 }); // scores 82

    expect(evaluateImageQuality(marginal, { minScore: 80 }).passed).toBe(true);
    expect(evaluateImageQuality(marginal, { minScore: 90 }).passed).toBe(false);
    expect(evaluateImageQuality(marginal, { minScore: 90 }).verdict).toBe(
      QUALITY_VERDICTS.NEEDS_BETTER_PHOTO,
    );
  });

  it('falls back to the registry default when the pass mark is unusable', () => {
    for (const minScore of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateImageQuality(measurements(), { minScore }).minScore).toBe(DEFAULT_MIN_SCORE);
    }
  });

  it('clamps a nonsensical stored pass mark instead of throwing', () => {
    // A hand-edited settings row must not be able to stop every admin publishing.
    expect(evaluateImageQuality(measurements(), { minScore: -20 }).minScore).toBe(0);
    expect(evaluateImageQuality(measurements(), { minScore: 400 }).minScore).toBe(100);
  });

  it('never produces a remediation string for a passing check', () => {
    const report = evaluateImageQuality(measurements({ format: 'gif' }));

    for (const check of report.checks) {
      expect(check.remediation === null).toBe(check.passed);
    }
  });
});

describe('meetsQualityBar — the §4.13 publish predicate', () => {
  it('accepts a score at or above the bar', () => {
    expect(meetsQualityBar(DEFAULT_MIN_SCORE, DEFAULT_MIN_SCORE)).toBe(true);
    expect(meetsQualityBar(DEFAULT_MIN_SCORE + 1, DEFAULT_MIN_SCORE)).toBe(true);
  });

  it('refuses a score below the bar', () => {
    expect(meetsQualityBar(DEFAULT_MIN_SCORE - 1, DEFAULT_MIN_SCORE)).toBe(false);
  });

  it('refuses a garment that has never been validated', () => {
    expect(meetsQualityBar(null, DEFAULT_MIN_SCORE)).toBe(false);
  });
});

describe('remediation copy (PRD §10.5, D-7)', () => {
  const everyRemediation = (): string[] => {
    const failures = evaluateImageQuality(
      measurements({
        width: 400,
        height: 200,
        longEdgePx: 400,
        shortEdgePx: 200,
        aspectRatio: 2,
        format: 'gif',
        backgroundUniformity: 0.1,
        subjectPixelRatio: 0.01,
        subjectBoundingBoxRatio: 0.95,
      }),
    );
    return failedChecks(failures).map((check) => check.remediation ?? '');
  };

  it('never apologises and never blames', () => {
    for (const message of everyRemediation()) {
      expect(message.toLowerCase()).not.toMatch(
        /sorry|apolog|unfortunately|oops|you failed|your mistake/,
      );
    }
  });

  it('opens with an imperative verb and ends in a full stop', () => {
    for (const message of everyRemediation()) {
      expect(message).toMatch(/^[A-Z][a-z]/);
      expect(message.endsWith('.')).toBe(true);
    }
  });

  it('avoids the internal vocabulary an admin has no reason to know', () => {
    for (const message of everyRemediation()) {
      expect(message.toLowerCase()).not.toMatch(
        /centroid|bounding box|pixel ratio|uniformity score/,
      );
    }
  });
});
