/**
 * Synthetic `ImageQualityMeasurements` for the A-10 tests.
 *
 * §3.6 puts the measuring in `ImageService.probeQuality()` and the judging in
 * `image-quality.validator.ts`. That split is what makes this file possible: the scoring can be
 * exercised at, just above and just below every threshold from plain numbers, with no image
 * encoded into the repository and no `sharp` call in a unit test (E-5).
 *
 * Not a `.spec.ts` file on purpose — two suites share it, and `apps/api/test/factories/` belongs
 * to the entity factories.
 */
import type { ImageQualityMeasurements } from '@library/storage';

/**
 * A photograph that passes all five A-10 checks with room to spare: 2400×3000 JPEG, a plain
 * backdrop, one centred piece filling a little under half the frame.
 */
export const PERFECT_MEASUREMENTS: ImageQualityMeasurements = {
  width: 2400,
  height: 3000,
  longEdgePx: 3000,
  shortEdgePx: 2400,
  aspectRatio: 0.8,
  format: 'jpeg',
  byteSize: 3_145_728,
  hasAlpha: false,
  backgroundUniformity: 0.94,
  subjectPixelRatio: 0.45,
  subjectBoundingBoxRatio: 0.62,
  subjectCentroidOffset: { x: 0.02, y: -0.04 },
  sample: { width: 205, height: 256 },
};

/**
 * `PERFECT_MEASUREMENTS` with the named fields replaced.
 *
 * `width`, `height`, `longEdgePx`, `shortEdgePx` and `aspectRatio` are **not** re-derived from
 * one another: a test that wants an impossible combination (a 1999px long edge on a 4000px
 * frame) is testing the validator, not `probeQuality()`, and must be free to say so.
 */
export function measurements(
  overrides: Partial<ImageQualityMeasurements> = {},
): ImageQualityMeasurements {
  return { ...PERFECT_MEASUREMENTS, ...overrides };
}

/** Measurements for a frame of the given pixel dimensions, with every derived field consistent. */
export function framedMeasurements(
  width: number,
  height: number,
  overrides: Partial<ImageQualityMeasurements> = {},
): ImageQualityMeasurements {
  return measurements({
    width,
    height,
    longEdgePx: Math.max(width, height),
    shortEdgePx: Math.min(width, height),
    aspectRatio: width / height,
    ...overrides,
  });
}
