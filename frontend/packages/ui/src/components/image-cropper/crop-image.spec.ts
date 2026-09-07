import { describe, expect, it } from 'vitest';

import { largestCrop, outputSize, rotatedBounds } from './crop-image';

const TWO_BY_THREE = 1024 / 1536;

describe('outputSize', () => {
  it('caps the long edge and derives the short one from the ratio', () => {
    expect(outputSize({ width: 4000, height: 6000 }, TWO_BY_THREE, 1600)).toEqual({
      width: 1067,
      height: 1600,
    });
  });

  it('never scales a small crop up to the cap', () => {
    expect(outputSize({ width: 600, height: 900 }, TWO_BY_THREE, 1600)).toEqual({
      width: 600,
      height: 900,
    });
  });

  it('holds the ratio to within half a pixel however awkward the crop', () => {
    for (const height of [901, 1013, 1279, 1444, 1599]) {
      const size = outputSize({ width: height * 0.6661, height }, TWO_BY_THREE, 4096);
      expect(Math.abs(size.width / size.height - TWO_BY_THREE)).toBeLessThan(0.0006);
    }
  });

  it('puts the long edge on width for a landscape ratio', () => {
    expect(outputSize({ width: 3000, height: 2000 }, 1.5, 2048)).toEqual({
      width: 2048,
      height: 1365,
    });
  });

  it('never returns a zero edge', () => {
    const size = outputSize({ width: 1, height: 1 }, TWO_BY_THREE, 1600);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe('rotatedBounds', () => {
  it('leaves an unrotated image alone', () => {
    expect(rotatedBounds({ width: 300, height: 200 }, 0)).toEqual({ width: 300, height: 200 });
  });

  it('swaps the axes on a quarter turn', () => {
    const bounds = rotatedBounds({ width: 300, height: 200 }, 90);
    expect(Math.round(bounds.width)).toBe(200);
    expect(Math.round(bounds.height)).toBe(300);
  });

  it('treats a half turn as no turn at all', () => {
    const bounds = rotatedBounds({ width: 300, height: 200 }, 180);
    expect(Math.round(bounds.width)).toBe(300);
    expect(Math.round(bounds.height)).toBe(200);
  });
});

describe('largestCrop', () => {
  it('fills the width of a source that is already narrower than the frame', () => {
    expect(largestCrop({ width: 1000, height: 2000 }, 0, TWO_BY_THREE)).toEqual({
      width: 1000,
      height: 1500,
    });
  });

  it('fills the height of a source that is wider than the frame', () => {
    expect(largestCrop({ width: 4000, height: 3000 }, 0, TWO_BY_THREE)).toEqual({
      width: 2000,
      height: 3000,
    });
  });

  it('re-measures after a quarter turn', () => {
    expect(largestCrop({ width: 4000, height: 3000 }, 90, TWO_BY_THREE)).toEqual({
      width: 2667,
      height: 4000,
    });
  });
});
