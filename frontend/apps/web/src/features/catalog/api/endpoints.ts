
import { apiClient, UPLOAD_TICKET_HEADER, type Paginated, type Uuid } from '@repo/api-client';

import type {
  AdminGarment,
  AdminGarmentImage,
  AdminGarmentQuery,
  BulkGarmentBody,
  BulkGarmentResult,
  BulkTestRenderBody,
  BulkTestRenderQueued,
  CreateGarmentBody,
  CreateGarmentImageBody,
  CreateUploadTicketBody,
  DeleteGarmentBody,
  GarmentImageWithQuality,
  ImageQualityReport,
  QualityOverrideBody,
  ReferenceModel,
  RejectTestRenderBody,
  ReorderGarmentImagesBody,
  RunTestRenderBody,
  TestRender,
  TestRenderBatch,
  TestRenderEstimate,
  UpdateGarmentBody,
  UpdateGarmentImageBody,
  UploadResult,
  UploadTicket,
} from '@/features/catalog/types/admin-catalog';

/** Path builders, so no URL is assembled from string parts at a call site. */
export const catalogPaths = {
  garments: '/admin/garments',
  garment: (garmentId: Uuid): string => `/admin/garments/${garmentId}`,
  publish: (garmentId: Uuid): string => `/admin/garments/${garmentId}/publish`,
  unpublish: (garmentId: Uuid): string => `/admin/garments/${garmentId}/unpublish`,
  archive: (garmentId: Uuid): string => `/admin/garments/${garmentId}/archive`,
  qualityOverride: (garmentId: Uuid): string => `/admin/garments/${garmentId}/quality-override`,
  bulk: '/admin/garments/bulk',
  images: (garmentId: Uuid): string => `/admin/garments/${garmentId}/images`,
  imagesReorder: (garmentId: Uuid): string => `/admin/garments/${garmentId}/images/reorder`,
  image: (imageId: Uuid): string => `/admin/garment-images/${imageId}`,
  imageTryOnSource: (imageId: Uuid): string => `/admin/garment-images/${imageId}/tryon-source`,
  imageRevalidate: (imageId: Uuid): string => `/admin/garment-images/${imageId}/revalidate`,
  referenceModels: '/admin/reference-models',
  testRender: (garmentId: Uuid): string => `/admin/garments/${garmentId}/test-render`,
  testRenderApprove: (garmentId: Uuid): string =>
    `/admin/garments/${garmentId}/test-render/approve`,
  testRenderReject: (garmentId: Uuid): string => `/admin/garments/${garmentId}/test-render/reject`,
  runTestRender: '/admin/tryon/test-render',
  bulkTestRender: '/admin/tryon/test-render/bulk',
  bulkTestRenderEstimate: '/admin/tryon/test-render/bulk/estimate',
  testRenderBatch: (batchId: Uuid): string => `/admin/tryon/batches/${batchId}`,
  uploadTicket: '/files/upload-ticket',
} as const;

/* ================================================================== *
 * Garments — §5.6
 * ================================================================== */

export async function listGarments(
  query: AdminGarmentQuery,
  signal?: AbortSignal,
): Promise<Paginated<AdminGarment>> {
  const response = await apiClient.get<Paginated<AdminGarment>>(catalogPaths.garments, {
    params: query,
    signal,
  });
  return response.data;
}

export async function getGarment(garmentId: Uuid, signal?: AbortSignal): Promise<AdminGarment> {
  const response = await apiClient.get<AdminGarment>(catalogPaths.garment(garmentId), { signal });
  return response.data;
}

export async function createGarment(body: CreateGarmentBody): Promise<AdminGarment> {
  const response = await apiClient.post<AdminGarment>(catalogPaths.garments, body);
  return response.data;
}

export async function updateGarment(
  garmentId: Uuid,
  body: UpdateGarmentBody,
): Promise<AdminGarment> {
  const response = await apiClient.patch<AdminGarment>(catalogPaths.garment(garmentId), body);
  return response.data;
}

/** 204 — a soft delete, so analytics history and the foreign keys pointing at it survive (A-13). */
export async function deleteGarment(garmentId: Uuid, body: DeleteGarmentBody): Promise<void> {
  await apiClient.delete<void>(catalogPaths.garment(garmentId), { data: body });
}

export async function publishGarment(garmentId: Uuid): Promise<AdminGarment> {
  const response = await apiClient.post<AdminGarment>(catalogPaths.publish(garmentId));
  return response.data;
}

export async function unpublishGarment(garmentId: Uuid): Promise<AdminGarment> {
  const response = await apiClient.post<AdminGarment>(catalogPaths.unpublish(garmentId));
  return response.data;
}

export async function archiveGarment(garmentId: Uuid): Promise<AdminGarment> {
  const response = await apiClient.post<AdminGarment>(catalogPaths.archive(garmentId));
  return response.data;
}

/** Records the A-10 waiver. It publishes nothing — that is still a separate, deliberate call. */
export async function overrideGarmentQuality(
  garmentId: Uuid,
  body: QualityOverrideBody,
): Promise<AdminGarment> {
  const response = await apiClient.post<AdminGarment>(
    catalogPaths.qualityOverride(garmentId),
    body,
  );
  return response.data;
}

/** 207 when some items fail; the payload shape is identical either way (D-16). */
export async function bulkGarments(body: BulkGarmentBody): Promise<BulkGarmentResult> {
  const response = await apiClient.post<BulkGarmentResult>(catalogPaths.bulk, body);
  return response.data;
}

/* ================================================================== *
 * Images — §5.7
 * ================================================================== */

export async function listGarmentImages(
  garmentId: Uuid,
  signal?: AbortSignal,
): Promise<AdminGarmentImage[]> {
  const response = await apiClient.get<AdminGarmentImage[]>(catalogPaths.images(garmentId), {
    signal,
  });
  return response.data;
}

/**
 * Step 3 of §3.5. Returns `{ image, quality }` when the new image is the try-on source and the
 * bare image otherwise, so the caller narrows on the presence of `quality`.
 */
export async function createGarmentImage(
  garmentId: Uuid,
  body: CreateGarmentImageBody,
): Promise<GarmentImageWithQuality | AdminGarmentImage> {
  const response = await apiClient.post<GarmentImageWithQuality | AdminGarmentImage>(
    catalogPaths.images(garmentId),
    body,
  );
  return response.data;
}

export async function updateGarmentImage(
  imageId: Uuid,
  body: UpdateGarmentImageBody,
): Promise<AdminGarmentImage> {
  const response = await apiClient.patch<AdminGarmentImage>(catalogPaths.image(imageId), body);
  return response.data;
}

export async function reorderGarmentImages(
  garmentId: Uuid,
  body: ReorderGarmentImagesBody,
): Promise<AdminGarmentImage[]> {
  const response = await apiClient.post<AdminGarmentImage[]>(
    catalogPaths.imagesReorder(garmentId),
    body,
  );
  return response.data;
}

/** Clears the previous source and resets `testRenderState` to `NONE` in one transaction (A-9). */
export async function setTryOnSource(imageId: Uuid): Promise<GarmentImageWithQuality> {
  const response = await apiClient.post<GarmentImageWithQuality>(
    catalogPaths.imageTryOnSource(imageId),
  );
  return response.data;
}

export async function revalidateGarmentImage(imageId: Uuid): Promise<ImageQualityReport> {
  const response = await apiClient.post<ImageQualityReport>(catalogPaths.imageRevalidate(imageId));
  return response.data;
}

export async function deleteGarmentImage(imageId: Uuid): Promise<void> {
  await apiClient.delete<void>(catalogPaths.image(imageId));
}

/* ================================================================== *
 * Test render — §5.11 (admin rows)
 * ================================================================== */

export async function listReferenceModels(signal?: AbortSignal): Promise<ReferenceModel[]> {
  const response = await apiClient.get<ReferenceModel[]>(catalogPaths.referenceModels, { signal });
  return response.data;
}

export async function getTestRender(garmentId: Uuid, signal?: AbortSignal): Promise<TestRender> {
  const response = await apiClient.get<TestRender>(catalogPaths.testRender(garmentId), { signal });
  return response.data;
}

/** Spends platform budget under `TEST_RENDER` and no consumer quota (§8.4). */
export async function runTestRender(body: RunTestRenderBody): Promise<TestRender> {
  const response = await apiClient.post<TestRender>(catalogPaths.runTestRender, body);
  return response.data;
}

export async function approveTestRender(garmentId: Uuid): Promise<TestRender> {
  const response = await apiClient.post<TestRender>(catalogPaths.testRenderApprove(garmentId));
  return response.data;
}

export async function rejectTestRender(
  garmentId: Uuid,
  body: RejectTestRenderBody,
): Promise<TestRender> {
  const response = await apiClient.post<TestRender>(catalogPaths.testRenderReject(garmentId), body);
  return response.data;
}

/** A-12 — the estimate is read-only and spends nothing. */
export async function estimateBulkTestRender(garmentIds: Uuid[]): Promise<TestRenderEstimate> {
  const response = await apiClient.post<TestRenderEstimate>(catalogPaths.bulkTestRenderEstimate, {
    garmentIds,
  });
  return response.data;
}

export async function queueBulkTestRender(body: BulkTestRenderBody): Promise<BulkTestRenderQueued> {
  const response = await apiClient.post<BulkTestRenderQueued>(catalogPaths.bulkTestRender, body);
  return response.data;
}

export async function getTestRenderBatch(
  batchId: Uuid,
  signal?: AbortSignal,
): Promise<TestRenderBatch> {
  const response = await apiClient.get<TestRenderBatch>(catalogPaths.testRenderBatch(batchId), {
    signal,
  });
  return response.data;
}

/* ================================================================== *
 * Files — §3.5, §5.20
 * ================================================================== */

export async function createUploadTicket(body: CreateUploadTicketBody): Promise<UploadTicket> {
  const response = await apiClient.post<UploadTicket>(catalogPaths.uploadTicket, body);
  return response.data;
}

export interface RedeemTicketOptions {
  /** 0–100, emitted as the bytes go out. This is what draws the A-9 per-file bar. */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export async function redeemUploadTicket(
  ticket: UploadTicket,
  file: File,
  options: RedeemTicketOptions = {},
): Promise<UploadResult> {
  const response = await apiClient.put<UploadResult>(ticket.uploadUrl, file, {
    headers: { [UPLOAD_TICKET_HEADER]: ticket.ticket, 'Content-Type': ticket.contentType },
    signal: options.signal,
    onUploadProgress: (event) => {
      if (!options.onProgress) return;
      const total = event.total ?? file.size;
      if (total <= 0) return;
      options.onProgress(Math.min(100, Math.round((event.loaded / total) * 100)));
    },
  });
  return response.data;
}
