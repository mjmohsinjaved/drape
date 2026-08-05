/**
 * `garments` — ARCHITECTURE.md §5.6, plus the §5.7 image routes that hang off the same prefix.
 *
 * Every route here is `@Roles(ADMIN)`. The consumer-facing catalog is a different module
 * entirely — see `catalog.ts`.
 */


import {
  delNoContent,
  delWithBodyNoContent,
  get,
  getList,
  patch,
  post,
  segment,
  type EndpointOptions,
} from './http';

import type { Paginated } from '../types/envelope';
import type {
  CreateGarmentImageRequest,
  GarmentImage,
  GarmentImageBatchRequest,
  GarmentImageBatchResponse,
  GarmentImageWithQuality,
  ReorderGarmentImagesRequest,
  UpdateGarmentImageRequest,
} from '../types/garment-images';
import type {
  AdminGarment,
  AdminGarmentListQuery,
  BulkGarmentRequest,
  BulkGarmentResult,
  CatalogHealth,
  CatalogHealthQuery,
  CreateGarmentRequest,
  DeleteGarmentRequest,
  QualityOverrideRequest,
  UpdateGarmentRequest,
ImageQualityReport } from '../types/garments';

export const garmentPaths = {
  garments: '/admin/garments',
  garment: (garmentId: string): string => `/admin/garments/${segment(garmentId)}`,
  bulk: '/admin/garments/bulk',
  publish: (garmentId: string): string => `/admin/garments/${segment(garmentId)}/publish`,
  unpublish: (garmentId: string): string => `/admin/garments/${segment(garmentId)}/unpublish`,
  archive: (garmentId: string): string => `/admin/garments/${segment(garmentId)}/archive`,
  qualityOverride: (garmentId: string): string =>
    `/admin/garments/${segment(garmentId)}/quality-override`,

  images: (garmentId: string): string => `/admin/garments/${segment(garmentId)}/images`,
  imagesReorder: (garmentId: string): string =>
    `/admin/garments/${segment(garmentId)}/images/reorder`,
  image: (imageId: string): string => `/admin/garment-images/${segment(imageId)}`,
  imageTryOnSource: (imageId: string): string =>
    `/admin/garment-images/${segment(imageId)}/tryon-source`,
  imageRevalidate: (imageId: string): string =>
    `/admin/garment-images/${segment(imageId)}/revalidate`,
  imageBatch: '/admin/garment-images/batch',

  catalogHealth: '/admin/catalog-health',
} as const;

/* ------------------------------------------------------------------ garments (A-7, A-8) */

/** `GET /admin/garments` (ADMIN) — A-14. Paginated (§2.8). */
export async function listGarments(
  query: AdminGarmentListQuery = {},
  options?: EndpointOptions,
): Promise<Paginated<AdminGarment>> {
  return getList<AdminGarment>(garmentPaths.garments, options, query);
}

/** `GET /admin/garments/:garmentId` (ADMIN). The gallery is a separate call. */
export async function getGarment(
  garmentId: string,
  options?: EndpointOptions,
): Promise<AdminGarment> {
  return get<AdminGarment>(garmentPaths.garment(garmentId), options);
}

/** `POST /admin/garments` (ADMIN) — A-7, A-8. */
export async function createGarment(
  body: CreateGarmentRequest,
  options?: EndpointOptions,
): Promise<AdminGarment> {
  return post<AdminGarment, CreateGarmentRequest>(garmentPaths.garments, body, options);
}

/** `PATCH /admin/garments/:garmentId` (ADMIN). */
export async function updateGarment(
  garmentId: string,
  body: UpdateGarmentRequest,
  options?: EndpointOptions,
): Promise<AdminGarment> {
  return patch<AdminGarment, UpdateGarmentRequest>(
    garmentPaths.garment(garmentId),
    body,
    options,
  );
}

/**
 * `DELETE /admin/garments/:garmentId` (ADMIN) — **204, no body back** (D-17).
 *
 * The typed title goes in the request body, which is why this is not a plain `delete`.
 */
export async function deleteGarment(
  garmentId: string,
  body: DeleteGarmentRequest,
  options?: EndpointOptions,
): Promise<void> {
  return delWithBodyNoContent<DeleteGarmentRequest>(
    garmentPaths.garment(garmentId),
    body,
    options,
  );
}

/** `POST /admin/garments/:garmentId/publish` (ADMIN) — refused unless A-10 and A-11 pass. */
export async function publishGarment(
  garmentId: string,
  options?: EndpointOptions,
): Promise<AdminGarment> {
  return post<AdminGarment>(garmentPaths.publish(garmentId), undefined, options);
}

/** `POST /admin/garments/:garmentId/unpublish` (ADMIN). */
export async function unpublishGarment(
  garmentId: string,
  options?: EndpointOptions,
): Promise<AdminGarment> {
  return post<AdminGarment>(garmentPaths.unpublish(garmentId), undefined, options);
}

/** `POST /admin/garments/:garmentId/archive` (ADMIN) — A-13. Retired, not deleted. */
export async function archiveGarment(
  garmentId: string,
  options?: EndpointOptions,
): Promise<AdminGarment> {
  return post<AdminGarment>(garmentPaths.archive(garmentId), undefined, options);
}

/** `POST /admin/garments/:garmentId/quality-override` (ADMIN) — A-10. The reason is audited. */
export async function overrideGarmentQuality(
  garmentId: string,
  body: QualityOverrideRequest,
  options?: EndpointOptions,
): Promise<AdminGarment> {
  return post<AdminGarment, QualityOverrideRequest>(
    garmentPaths.qualityOverride(garmentId),
    body,
    options,
  );
}

/** `POST /admin/garments/bulk` (ADMIN) — A-12. Partial failure is normal; render it (D-16). */
export async function bulkUpdateGarments(
  body: BulkGarmentRequest,
  options?: EndpointOptions,
): Promise<BulkGarmentResult> {
  return post<BulkGarmentResult, BulkGarmentRequest>(garmentPaths.bulk, body, options);
}

/** `GET /admin/catalog-health` (ADMIN) — the whole A-15 panel in one response. */
export async function getCatalogHealth(
  query: CatalogHealthQuery = {},
  options?: EndpointOptions,
): Promise<CatalogHealth> {
  return get<CatalogHealth>(garmentPaths.catalogHealth, options, query);
}

/* ------------------------------------------------------------------ images (§5.7, A-9) */

/** `GET /admin/garments/:garmentId/images` (ADMIN) — the gallery, in position order. */
export async function listGarmentImages(
  garmentId: string,
  options?: EndpointOptions,
): Promise<GarmentImage[]> {
  return get<GarmentImage[]>(garmentPaths.images(garmentId), options);
}

/**
 * `POST /admin/garments/:garmentId/images` (ADMIN) — step 3 of the §3.5 upload flow.
 *
 * Answers the image **and** its A-10 verdict, so one round trip says whether the piece can be
 * published.
 */
export async function createGarmentImage(
  garmentId: string,
  body: CreateGarmentImageRequest,
  options?: EndpointOptions,
): Promise<GarmentImageWithQuality> {
  return post<GarmentImageWithQuality, CreateGarmentImageRequest>(
    garmentPaths.images(garmentId),
    body,
    options,
  );
}

/** `POST /admin/garments/:garmentId/images/reorder` (ADMIN). The whole set, never a delta. */
export async function reorderGarmentImages(
  garmentId: string,
  body: ReorderGarmentImagesRequest,
  options?: EndpointOptions,
): Promise<GarmentImage[]> {
  return post<GarmentImage[], ReorderGarmentImagesRequest>(
    garmentPaths.imagesReorder(garmentId),
    body,
    options,
  );
}

/** `PATCH /admin/garment-images/:imageId` (ADMIN) — alt text or gallery position (D-20). */
export async function updateGarmentImage(
  imageId: string,
  body: UpdateGarmentImageRequest,
  options?: EndpointOptions,
): Promise<GarmentImage> {
  return patch<GarmentImage, UpdateGarmentImageRequest>(
    garmentPaths.image(imageId),
    body,
    options,
  );
}

/**
 * `POST /admin/garment-images/:imageId/tryon-source` (ADMIN) — A-9.
 *
 * Promoting a new source demotes the old one and resets `testRenderState` to `NONE`, which makes
 * the garment unpublishable until a fresh test render is approved (A-11).
 */
export async function setTryOnSource(
  imageId: string,
  options?: EndpointOptions,
): Promise<GarmentImageWithQuality> {
  return post<GarmentImageWithQuality>(garmentPaths.imageTryOnSource(imageId), undefined, options);
}

/** `POST /admin/garment-images/:imageId/revalidate` (ADMIN) — re-runs the A-10 checks. */
export async function revalidateGarmentImage(
  imageId: string,
  options?: EndpointOptions,
): Promise<ImageQualityReport> {
  return post<ImageQualityReport>(garmentPaths.imageRevalidate(imageId), undefined, options);
}

/** `DELETE /admin/garment-images/:imageId` (ADMIN) — 204. */
export async function deleteGarmentImage(
  imageId: string,
  options?: EndpointOptions,
): Promise<void> {
  return delNoContent(garmentPaths.image(imageId), options);
}

/**
 * `POST /admin/garment-images/batch` (ADMIN) — §6.2.
 *
 * The primary image of many garments in one request, so the catalog table draws its 40px row
 * thumbnails without a request per row. A POST because the id list is a body.
 */
export async function getPrimaryGarmentImages(
  body: GarmentImageBatchRequest,
  options?: EndpointOptions,
): Promise<GarmentImageBatchResponse> {
  return post<GarmentImageBatchResponse, GarmentImageBatchRequest>(
    garmentPaths.imageBatch,
    body,
    options,
  );
}
