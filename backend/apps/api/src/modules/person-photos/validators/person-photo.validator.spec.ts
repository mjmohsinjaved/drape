/**
 * PRD C-14, E-5 — "unit coverage of … image validation rules".
 *
 * C-14 puts a validation pass in the browser. These are the rules that run again on
 * the server, over the bytes that actually landed, because the browser's pass can be
 * skipped by anyone who talks to the API directly.
 */
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_LONG_EDGE_PX,
  MIN_PHOTO_LONG_EDGE_PX,
  MIN_PHOTO_SHORT_EDGE_PX,
} from '../constants/person-photo.constants';

import { isAllowedPhotoFormat, PHOTO_CHECKS, validatePersonPhoto } from './person-photo.validator';

import type { PhotoMeasurements } from './person-photo.validator';

/** A full-body portrait from a mid-range Android — the case that must always pass. */
function goodPhoto(overrides: Partial<PhotoMeasurements> = {}): PhotoMeasurements {
  return { width: 1080, height: 1620, format: 'jpeg', byteSize: 842_133, ...overrides };
}

function failedChecks(measurements: PhotoMeasurements): string[] {
  return validatePersonPhoto(measurements).failures.map((failure) => failure.check);
}

describe('validatePersonPhoto — the happy path', () => {
  it('accepts a portrait full-body photo', () => {
    const verdict = validatePersonPhoto(goodPhoto());

    expect(verdict.passed).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.longEdgePx).toBe(1620);
    expect(verdict.shortEdgePx).toBe(1080);
    expect(verdict.aspectRatio).toBeCloseTo(0.667, 3);
  });

  it.each(['jpeg', 'jpg', 'png', 'webp', 'heif', 'HEIF'])('accepts %s', (format) => {
    expect(isAllowedPhotoFormat(format)).toBe(true);
    expect(validatePersonPhoto(goodPhoto({ format })).passed).toBe(true);
  });
});

describe('validatePersonPhoto — resolution', () => {
  it('accepts exactly the minimum long edge', () => {
    // Boundary: >= is the rule, so the floor itself must pass.
    const verdict = validatePersonPhoto(
      goodPhoto({ width: MIN_PHOTO_SHORT_EDGE_PX, height: MIN_PHOTO_LONG_EDGE_PX }),
    );
    expect(verdict.passed).toBe(true);
  });

  it('rejects one pixel below the minimum long edge, and says what it measured', () => {
    const verdict = validatePersonPhoto(
      goodPhoto({ width: 520, height: MIN_PHOTO_LONG_EDGE_PX - 1 }),
    );

    expect(verdict.passed).toBe(false);
    const failure = verdict.failures.find((item) => item.check === PHOTO_CHECKS.LONG_EDGE);
    expect(failure?.actual).toBe(MIN_PHOTO_LONG_EDGE_PX - 1);
    expect(failure?.message).toContain(`${MIN_PHOTO_LONG_EDGE_PX - 1}px`);
  });

  it('rejects a photo whose short edge is too small even when the long edge passes', () => {
    expect(failedChecks(goodPhoto({ width: 300, height: 2000 }))).toContain(
      PHOTO_CHECKS.SHORT_EDGE,
    );
  });

  it('rejects an implausibly large frame', () => {
    expect(failedChecks(goodPhoto({ width: 9000, height: MAX_PHOTO_LONG_EDGE_PX + 1 }))).toContain(
      PHOTO_CHECKS.LONG_EDGE,
    );
  });
});

describe('validatePersonPhoto — framing (C-13)', () => {
  it('rejects a landscape photo — a full-body frame cannot fit in one', () => {
    expect(failedChecks(goodPhoto({ width: 1920, height: 1080 }))).toContain(
      PHOTO_CHECKS.ASPECT_RATIO,
    );
  });

  it('accepts a near-square frame at the top of the band', () => {
    expect(validatePersonPhoto(goodPhoto({ width: 1000, height: 1000 })).passed).toBe(true);
  });

  it('rejects an extremely narrow frame', () => {
    expect(failedChecks(goodPhoto({ width: 600, height: 4000 }))).toContain(
      PHOTO_CHECKS.ASPECT_RATIO,
    );
  });
});

describe('validatePersonPhoto — format and size', () => {
  it.each(['gif', 'tiff', 'svg', 'bmp', 'avif'])('rejects %s', (format) => {
    expect(isAllowedPhotoFormat(format)).toBe(false);
    expect(failedChecks(goodPhoto({ format }))).toContain(PHOTO_CHECKS.FORMAT);
  });

  it('accepts exactly the byte ceiling and rejects one byte more', () => {
    expect(validatePersonPhoto(goodPhoto({ byteSize: MAX_PHOTO_BYTES })).passed).toBe(true);
    expect(failedChecks(goodPhoto({ byteSize: MAX_PHOTO_BYTES + 1 }))).toContain(
      PHOTO_CHECKS.BYTE_SIZE,
    );
  });
});

describe('validatePersonPhoto — reporting', () => {
  it('reports every failure at once, so a fix is one round trip (C-14)', () => {
    // Small, landscape, and the wrong format. Telling her about one at a time turns a
    // single retake into three.
    const checks = failedChecks({ width: 640, height: 480, format: 'gif', byteSize: 1000 });

    expect(checks).toEqual(
      expect.arrayContaining([
        PHOTO_CHECKS.FORMAT,
        PHOTO_CHECKS.LONG_EDGE,
        PHOTO_CHECKS.SHORT_EDGE,
        PHOTO_CHECKS.ASPECT_RATIO,
      ]),
    );
  });

  it('treats an unmeasurable frame as a resolution failure rather than dividing by zero', () => {
    const verdict = validatePersonPhoto({ width: 0, height: 0, format: 'jpeg', byteSize: 10 });

    expect(verdict.passed).toBe(false);
    expect(verdict.aspectRatio).toBe(0);
    expect(verdict.failures.map((failure) => failure.check)).toContain(PHOTO_CHECKS.LONG_EDGE);
  });

  it('never puts a storage key or a URL in a failure message', () => {
    const verdict = validatePersonPhoto({ width: 100, height: 900, format: 'gif', byteSize: 10 });

    for (const failure of verdict.failures) {
      expect(failure.message).not.toMatch(/person-photos\//);
      expect(failure.message).not.toMatch(/https?:/);
    }
  });
});
