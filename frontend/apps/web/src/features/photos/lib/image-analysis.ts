/**
 * The pixel maths behind the C-14 client-side checks.
 *
 * Kept apart from `validate-photo.ts` so the arithmetic can be reasoned about — and, later,
 * tested — without a `File`, a canvas or a browser in the way. Everything here takes plain
 * numbers and returns plain numbers.
 *
 * All of it runs on a **downscaled greyscale copy** (`ANALYSIS_EDGE` on the long edge). A phone
 * photo is twelve megapixels; running a connected-component pass over that on a mid-range
 * Android would freeze the tab for seconds. At this size the whole analysis is a few
 * milliseconds and the answers are identical, because every question being asked is about
 * large-scale structure, not detail.
 */

/** Long edge of the analysis buffer. Large enough for structure, small enough to be instant. */
export const ANALYSIS_EDGE = 192;

export interface GreyImage {
  /** Luma, 0–255, row-major. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Rec. 601 luma — the weighting that matches perceived brightness. */
export function toGreyscale(rgba: Uint8ClampedArray, width: number, height: number): GreyImage {
  const data = new Uint8ClampedArray(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[index] =
      0.299 * (rgba[offset] ?? 0) +
      0.587 * (rgba[offset + 1] ?? 0) +
      0.114 * (rgba[offset + 2] ?? 0);
  }
  return { data, width, height };
}

export function meanLuma(image: GreyImage): number {
  let total = 0;
  for (const value of image.data) total += value;
  return image.data.length === 0 ? 0 : total / image.data.length;
}

/**
 * Variance of the Laplacian — the standard sharpness estimate.
 *
 * A sharp photo has strong second derivatives at every edge, so the response varies wildly. A
 * soft one has a flat response and a low variance. The threshold is empirical and deliberately
 * forgiving: refusing a usable photo costs her the upload, and the API re-checks anyway.
 */
export function laplacianVariance(image: GreyImage): number {
  const { data, width, height } = image;
  if (width < 3 || height < 3) return 0;

  const responses: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const centre = data[y * width + x] ?? 0;
      const up = data[(y - 1) * width + x] ?? 0;
      const down = data[(y + 1) * width + x] ?? 0;
      const left = data[y * width + x - 1] ?? 0;
      const right = data[y * width + x + 1] ?? 0;
      responses.push(up + down + left + right - 4 * centre);
    }
  }

  const mean = responses.reduce((sum, value) => sum + value, 0) / responses.length;
  const variance =
    responses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / responses.length;
  return variance;
}

/**
 * The background luma, estimated as the median of the border ring.
 *
 * The median rather than the mean, because a mean is dragged around by whatever happens to be
 * touching one edge — a doorframe, a shadow, an arm — and the median is not.
 */
export function estimateBackgroundLuma(image: GreyImage): number {
  const samples = borderSamples(image);
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function borderSamples(image: GreyImage): number[] {
  const { data, width, height } = image;
  const samples: number[] = [];
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.06));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const onBorder = x < band || x >= width - band || y < band || y >= height - band;
      if (onBorder) samples.push(data[y * width + x] ?? 0);
    }
  }
  return samples;
}

export interface SubjectMask {
  /** 1 where the pixel differs from the background, 0 where it matches. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Share of the frame the subject occupies. */
  coverage: number;
  /** Topmost and bottommost rows holding subject pixels, or -1 when there are none. */
  topRow: number;
  bottomRow: number;
}

/**
 * Separates foreground from background by luma distance.
 *
 * This is not segmentation and does not pretend to be — it is a threshold against an estimated
 * background. Any background is now allowed, so the mask is only as good as the contrast between
 * the subject and whatever is behind her: against a plain wall it traces her outline, against a
 * forest it lights up half the frame. Everything downstream is written to fail *open* on that,
 * because a photo refused for a tree is worse than a photo accepted for one.
 */
export function buildSubjectMask(image: GreyImage, threshold = 30): SubjectMask {
  const { data, width, height } = image;
  const background = estimateBackgroundLuma(image);
  const mask = new Uint8Array(width * height);

  let filled = 0;
  let topRow = -1;
  let bottomRow = -1;

  for (let y = 0; y < height; y += 1) {
    let rowHas = false;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (Math.abs((data[index] ?? 0) - background) > threshold) {
        mask[index] = 1;
        filled += 1;
        rowHas = true;
      }
    }
    if (rowHas) {
      if (topRow === -1) topRow = y;
      bottomRow = y;
    }
  }

  return {
    mask,
    width,
    height,
    coverage: filled / (width * height),
    topRow,
    bottomRow,
  };
}

/** Shape gates that separate "a person standing there" from "some scenery". */
const PERSON_SHAPE = {
  /** A standing figure fills a real share of the frame. Below this it is clutter. */
  MIN_AREA_RATIO: 0.06,
  /** Head to feet, or near enough. Scenery is rarely this tall *and* this narrow. */
  MIN_HEIGHT_RATIO: 0.4,
  /** Wider than this and it is a treeline, a sofa or a wall, not somebody standing. */
  MAX_WIDTH_RATIO: 0.6,
  /** People are taller than they are wide, even allowing for outstretched arms. */
  MIN_BOX_ASPECT: 1.2,
  /** A person fills much of her own bounding box; a branching, sprawling shape does not. */
  MIN_FILL: 0.25,
} as const;

/**
 * Counts foreground blobs that are **plausibly a standing person**.
 *
 * ### Why the shape gates exist
 *
 * The old version counted every blob over 4% of the frame and called each one a person. That
 * was defensible only while a plain background was mandatory, because then the only things
 * differing from the background *were* people. Once any background is allowed, foliage, rocks,
 * water and furniture all clear 4% and each one reads as another person — which is exactly the
 * false "there's more than one person in frame" this replaces.
 *
 * So a region has to look like a person to be counted as one: tall, not too wide, taller than
 * it is wide, and solid rather than sprawling. A second person standing beside her satisfies
 * all four; a tree behind her satisfies none.
 *
 * **This is a heuristic, not detection.** It is tuned to under-report rather than over-report:
 * two people very close together merge into one region and pass. That trade is deliberate —
 * refusing a genuine photo is the failure that actually costs someone the upload.
 *
 * Iterative flood fill with an explicit stack — a recursive one blows the call stack on a
 * large connected region, which is precisely the common case here.
 */
export function countSubjects(mask: SubjectMask, minAreaRatio = PERSON_SHAPE.MIN_AREA_RATIO): number {
  const { mask: pixels, width, height } = mask;
  const seen = new Uint8Array(width * height);
  const minArea = Math.max(1, Math.round(width * height * minAreaRatio));
  const stack: number[] = [];

  let regions = 0;

  for (let start = 0; start < pixels.length; start += 1) {
    if (pixels[start] !== 1 || seen[start] === 1) continue;

    let area = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      area += 1;

      const x = index % width;
      const y = Math.floor(index / width);

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Four-connectivity. Eight would bridge a shoulder to a shadow across a diagonal and
      // merge two people into one, which is the opposite of what this check is for.
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];

      for (const neighbour of neighbours) {
        if (neighbour < 0) continue;
        if (pixels[neighbour] === 1 && seen[neighbour] === 0) {
          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }

    if (area < minArea) continue;

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;

    const tallEnough = boxHeight / height >= PERSON_SHAPE.MIN_HEIGHT_RATIO;
    const narrowEnough = boxWidth / width <= PERSON_SHAPE.MAX_WIDTH_RATIO;
    const upright = boxHeight / boxWidth >= PERSON_SHAPE.MIN_BOX_ASPECT;
    const solid = area / (boxWidth * boxHeight) >= PERSON_SHAPE.MIN_FILL;

    if (tallEnough && narrowEnough && upright && solid) regions += 1;
  }

  return regions;
}

/** Mean luma of the middle third of the frame — where she is standing, if she followed the guide. */
export function centreLuma(image: GreyImage): number {
  const { data, width, height } = image;
  const x0 = Math.floor(width / 3);
  const x1 = Math.ceil((width * 2) / 3);
  const y0 = Math.floor(height / 4);
  const y1 = Math.ceil((height * 3) / 4);

  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      total += data[y * width + x] ?? 0;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}
