'use client';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface CropRequest {
  file: File;
  area: CropRect;
  rotation: number;
  aspect: number;
  maxEdge: number;
  type: 'image/jpeg' | 'image/png';
  quality: number;
  fileName: string;
}

export interface CroppedImage {
  file: File;
  width: number;
  height: number;
}

export class ImageDecodeError extends Error {
  constructor() {
    super('The image could not be decoded.');
    this.name = 'ImageDecodeError';
  }
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function rotatedBounds(size: Dimensions, rotation: number): Dimensions {
  const angle = radians(rotation);
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  return {
    width: size.width * cos + size.height * sin,
    height: size.width * sin + size.height * cos,
  };
}

export function largestCrop(size: Dimensions, rotation: number, aspect: number): Dimensions {
  const bounds = rotatedBounds(size, rotation);
  const width = Math.min(bounds.width, bounds.height * aspect);
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

export function outputSize(area: Dimensions, aspect: number, maxEdge: number): Dimensions {
  const longEdge = Math.max(1, Math.min(Math.round(Math.max(area.width, area.height)), maxEdge));

  return aspect >= 1
    ? { width: longEdge, height: Math.max(1, Math.round(longEdge / aspect)) }
    : { width: Math.max(1, Math.round(longEdge * aspect)), height: longEdge };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

function scaleDown(source: HTMLCanvasElement, target: Dimensions): HTMLCanvasElement {
  let current = source;

  while (current.width >= target.width * 2 && current.height >= target.height * 2) {
    const next = createCanvas(Math.round(current.width / 2), Math.round(current.height / 2));
    const context = next.getContext('2d');
    if (context === null) return current;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(current, 0, 0, next.width, next.height);

    if (current !== source) release(current);
    current = next;
  }

  return current;
}

async function decode(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') throw new ImageDecodeError();
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageDecodeError();
  }
}

export async function readImageSize(file: File): Promise<Dimensions> {
  const bitmap = await decode(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export async function cropImageToFile(request: CropRequest): Promise<CroppedImage> {
  const { file, area, rotation, aspect, maxEdge, type, quality, fileName } = request;

  const bitmap = await decode(file);

  const bounds = rotatedBounds({ width: bitmap.width, height: bitmap.height }, rotation);

  const width = Math.max(1, Math.round(Math.min(area.width, bounds.width)));
  const height = Math.max(1, Math.round(Math.min(area.height, bounds.height)));
  const x = Math.min(Math.max(Math.round(area.x), 0), Math.round(bounds.width) - width);
  const y = Math.min(Math.max(Math.round(area.y), 0), Math.round(bounds.height) - height);

  const cut = createCanvas(width, height);
  const context = cut.getContext('2d');
  if (context === null) {
    bitmap.close();
    release(cut);
    throw new ImageDecodeError();
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  context.translate(-x, -y);
  context.translate(bounds.width / 2, bounds.height / 2);
  context.rotate(radians(rotation));
  context.translate(-bitmap.width / 2, -bitmap.height / 2);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const target = outputSize({ width, height }, aspect, maxEdge);

  const stepped = scaleDown(cut, target);
  const out = createCanvas(target.width, target.height);
  const outContext = out.getContext('2d');
  if (outContext === null) {
    release(cut);
    if (stepped !== cut) release(stepped);
    release(out);
    throw new ImageDecodeError();
  }

  outContext.imageSmoothingEnabled = true;
  outContext.imageSmoothingQuality = 'high';
  outContext.drawImage(stepped, 0, 0, target.width, target.height);

  if (stepped !== cut) release(stepped);
  release(cut);

  const blob = await toBlob(out, type, quality);
  release(out);

  if (blob === null) throw new ImageDecodeError();

  return {
    file: new File([blob], fileName, { type, lastModified: Date.now() }),
    width: target.width,
    height: target.height,
  };
}
