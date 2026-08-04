/**
 * ARCHITECTURE.md §5.7 `garment-images` and §4.14.
 *
 * Exactly one image per garment may be the try-on source (`UQ_garment_images_source`). Designating
 * a new one clears the previous flag and resets `testRenderState` to `NONE` (A-9), which in turn
 * makes the garment unpublishable until a fresh test render is approved (A-11).
 */

import type { IsoDateTime, QualityCheckResult, Uuid } from './common';

/** One row of `GET /admin/garments/:garmentId/images` (ADMIN), in gallery order. */
export interface GarmentImage {
  id: Uuid;
  garmentId: Uuid;
  /** Signed URL (§3.4). The `storageKey` column never leaves the API. */
  url: string;
  thumbnailUrl: string | null;
  isTryOnSource: boolean;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  position: number;
  /** D-20 alt text on catalog images. */
  altText: string | null;
  /** Populated only for the try-on source, which is the image the A-10 validator runs against. */
  qualityScore: number | null;
  qualityChecks: QualityCheckResult[] | null;
  createdAt: IsoDateTime;
}

/**
 * `POST /admin/garments/:garmentId/images` (ADMIN) — finalises an already-uploaded file against
 * the garment. Runs the A-10 validator when the image is the try-on source, which can reject with
 * `GARMENT_QUALITY_BELOW_THRESHOLD`, `IMAGE_TOO_SMALL`, `IMAGE_FORMAT_UNSUPPORTED`,
 * `IMAGE_TOO_LARGE` or `IMAGE_CORRUPT`.
 */
export interface FinaliseGarmentImageRequest {
  /** The upload ticket redeemed by `PUT /files/upload/:ticket` (§3.5). */
  ticket: string;
  altText?: string | null;
  position?: number;
  /** Marks the new image as the try-on source in the same call (A-9). */
  isTryOnSource?: boolean;
}

/** `PATCH /admin/garment-images/:imageId` (ADMIN) — alt text or position only. */
export interface UpdateGarmentImageRequest {
  altText?: string | null;
  position?: number;
}

/**
 * `POST /admin/garment-images/:imageId/tryon-source` (ADMIN). Clears the previous source and
 * resets `testRenderState` to `NONE` (A-9). Designating an image that is already the source is
 * `TRYON_SOURCE_ALREADY_SET`.
 */
export interface SetTryOnSourceResponse {
  imageId: Uuid;
  garmentId: Uuid;
  /** Always `NONE` — the garment must be test-rendered again before it can be published. */
  testRenderState: 'NONE';
  qualityScore: number | null;
  qualityChecks: QualityCheckResult[] | null;
}

/** `POST /admin/garments/:garmentId/images/reorder` (ADMIN) — persists gallery order. */
export interface ReorderGarmentImagesRequest {
  /** Every image id for the garment, in the new gallery order. */
  orderedIds: Uuid[];
}

export interface ReorderGarmentImagesResponse {
  garmentId: Uuid;
  orderedIds: Uuid[];
}

/** `POST /admin/garment-images/:imageId/revalidate` (ADMIN) — re-runs the A-10 validator. */
export interface RevalidateGarmentImageResponse {
  imageId: Uuid;
  qualityScore: number;
  qualityChecks: QualityCheckResult[];
  /** False when the score is below `quality.minScore` and an override would be needed to publish. */
  passesThreshold: boolean;
}
