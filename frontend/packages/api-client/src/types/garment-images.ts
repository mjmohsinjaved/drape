/**
 * ARCHITECTURE.md §5.7 `garment-images` and §4.14.
 *
 * Exactly one image per garment may be the try-on source (`UQ_garment_images_source`). Designating
 * a new one clears the previous flag and resets `testRenderState` to `NONE` (A-9), which in turn
 * makes the garment unpublishable until a fresh test render is approved (A-11).
 *
 * Written against `modules/garments/dto/garment-image-*.dto.ts`.
 */

import type { IsoDateTime, Uuid } from './common';
import type { ImageQualityReport } from './garments';

/**
 * `GarmentImageResponseDto`. **No storage key ever reaches the client** (§3.4) — only signed,
 * expiring URLs.
 *
 * The A-10 verdict is not folded into this row: there is no `qualityScore` or `qualityChecks`
 * here. Where a route produces both, they travel as siblings — see {@link GarmentImageWithQuality}.
 */
export interface GarmentImage {
  id: Uuid;
  garmentId: Uuid;
  /** Signed, expiring URL for the full-size image. */
  url: string;
  /** Signed 320w thumbnail URL. */
  thumbnailUrl: string | null;
  /** The file sent upstream as `garment_image` (A-9). Exactly one per garment. */
  isTryOnSource: boolean;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  /** Gallery order, ascending. */
  position: number;
  /** Alt text (D-20). Describes the piece, not the photograph. */
  altText: string | null;
  createdAt: IsoDateTime;
}

/**
 * What the try-on-source routes return — `POST /admin/garments/:garmentId/images` and
 * `POST /admin/garment-images/:imageId/tryon-source`.
 *
 * The image and the A-10 verdict travel together so an admin learns in one round trip whether the
 * piece can be published (A-10).
 */
export interface GarmentImageWithQuality {
  image: GarmentImage;
  quality: ImageQualityReport;
}

/** `MAX_GALLERY_IMAGES` — the ceiling a gallery and a reorder are both bounded by. */
export const MAX_GALLERY_IMAGES = 60;

/** Alt text ceiling the API enforces, so the form can say so first. */
export const MAX_ALT_TEXT_LENGTH = 255;

/**
 * `POST /admin/garments/:garmentId/images` — step 3 of the §3.5 upload flow.
 *
 * The field is `key`: the value handed back by the upload-ticket redemption. There is no `ticket`
 * field — the ticket was already spent putting the bytes.
 */
export interface CreateGarmentImageRequest {
  key: string;
  /**
   * Refused when the garment already has a source; use
   * `POST /admin/garment-images/:imageId/tryon-source` to replace it, so demoting the current
   * source is always a deliberate act (A-9).
   */
  isTryOnSource?: boolean;
  altText?: string;
  /** Defaults to the end of the gallery. */
  position?: number;
}

/** `PATCH /admin/garment-images/:imageId` (D-20). */
export interface UpdateGarmentImageRequest {
  altText?: string;
  position?: number;
}

/**
 * `POST /admin/garments/:garmentId/images/reorder`.
 *
 * The whole ordering, never a delta — every image id of this garment, in the order they should
 * appear. The field is `imageIds`.
 */
export interface ReorderGarmentImagesRequest {
  imageIds: Uuid[];
}

/** `POST /admin/garment-images/batch` is bounded at this many garments; a longer list is refused. */
export const MAX_BATCH_GARMENT_IMAGES = 100;

/**
 * `POST /admin/garment-images/batch` (ADMIN) — the primary image of many garments in one request.
 *
 * What the admin catalog table needs to draw §6.2's 40px row thumbnail without a request per row.
 * It is a POST because the id list is a body, not a query string.
 */
export interface GarmentImageBatchRequest {
  garmentIds: Uuid[];
}

export interface GarmentImageBatchEntry {
  garmentId: Uuid;
  /**
   * The try-on source where there is one (A-9), the first image in gallery order otherwise.
   * `null` when the garment has no images at all — the entry is still returned, so the caller
   * can align its rows.
   */
  image: GarmentImage | null;
}

export interface GarmentImageBatchResponse {
  items: GarmentImageBatchEntry[];
}
