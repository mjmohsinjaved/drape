import { describe, expect, it } from 'vitest';

import {
  GARMENT_ASPECT,
  GARMENT_IMAGE_MAX_EDGE,
  GARMENT_IMAGE_MIN_LONG_EDGE,
  PERSON_ASPECT,
  PERSON_PHOTO_MAX_EDGE,
  PERSON_PHOTO_MIN_LONG_EDGE,
  RENDER_HEIGHT,
  RENDER_WIDTH,
} from './image-frame';

const A10 = { minAspect: 0.6, maxAspect: 1.0, minLongEdge: 2000 };

const C14 = { minAspect: 0.4, maxAspect: 1.05, minLongEdge: 800, minShortEdge: 500 };

describe('the person frame', () => {
  it('is the frame the try-on driver renders into', () => {
    expect(`${String(RENDER_WIDTH)}x${String(RENDER_HEIGHT)}`).toBe('1024x1536');
  });

  it('tracks the render exactly', () => {
    expect(PERSON_ASPECT).toBe(RENDER_WIDTH / RENDER_HEIGHT);
  });

  it('sits inside the C-14 aspect band', () => {
    expect(PERSON_ASPECT).toBeGreaterThanOrEqual(C14.minAspect);
    expect(PERSON_ASPECT).toBeLessThanOrEqual(C14.maxAspect);
  });

  it('produces a photo the API will accept at the upload cap', () => {
    const height = PERSON_PHOTO_MAX_EDGE;
    const width = Math.round(height * PERSON_ASPECT);

    expect(Math.max(width, height)).toBeGreaterThanOrEqual(C14.minLongEdge);
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(C14.minShortEdge);
  });

  it('produces a photo the API will accept at the client floor', () => {
    const height = PERSON_PHOTO_MIN_LONG_EDGE;
    const width = Math.round(height * PERSON_ASPECT);

    expect(Math.max(width, height)).toBeGreaterThanOrEqual(C14.minLongEdge);
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(C14.minShortEdge);
  });
});

describe('the garment frame', () => {
  it('sits inside the A-10 aspect band', () => {
    expect(GARMENT_ASPECT).toBeGreaterThanOrEqual(A10.minAspect);
    expect(GARMENT_ASPECT).toBeLessThanOrEqual(A10.maxAspect);
  });

  it('matches the §6.2 catalogue card, so a browse card crops nothing', () => {
    expect(GARMENT_ASPECT).toBe(3 / 4);
  });

  it('lets a crop reach the A-10 resolution floor', () => {
    expect(GARMENT_IMAGE_MAX_EDGE).toBeGreaterThanOrEqual(A10.minLongEdge);
    expect(GARMENT_IMAGE_MIN_LONG_EDGE).toBe(A10.minLongEdge);
  });

  it('is still portrait, so the cropper treats the long edge as the height', () => {
    expect(GARMENT_ASPECT).toBeLessThan(1);
  });
});

describe('the two frames together', () => {
  it('are deliberately different, and the difference is the garment being wider', () => {
    expect(GARMENT_ASPECT).toBeGreaterThan(PERSON_ASPECT);
  });

  it('costs the same to render either way', () => {
    expect(RENDER_WIDTH / RENDER_HEIGHT).toBe(PERSON_ASPECT);
  });
});
