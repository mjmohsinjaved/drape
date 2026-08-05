'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { queryKeys, type ApiError, type Uuid } from '@repo/api-client';

import {
  deleteGarmentImage,
  listGarmentImages,
  reorderGarmentImages,
  revalidateGarmentImage,
  setTryOnSource,
  updateGarmentImage,
} from '@/features/catalog/api/endpoints';

import type {
  AdminGarmentImage,
  GarmentImageWithQuality,
  ImageQualityReport,
  UpdateGarmentImageBody,
} from '@/features/catalog/types/admin-catalog';

/**
 * The gallery half of A-9.
 *
 * Designating a try-on source is the one image action with a consequence beyond the gallery: it
 * resets `testRenderState` to `NONE`, which makes the garment unpublishable until a fresh render
 * is approved (A-11). Every mutation that can move that column therefore invalidates the garment
 * detail as well as the image list.
 */

export function useGarmentImages(
  garmentId: Uuid,
  initialData?: AdminGarmentImage[],
): UseQueryResult<AdminGarmentImage[], ApiError> {
  return useQuery<AdminGarmentImage[], ApiError>({
    queryKey: queryKeys.garments.images(garmentId),
    queryFn: ({ signal }) => listGarmentImages(garmentId, signal),
    initialData,
  });
}

export interface ReorderImagesVariables {
  garmentId: Uuid;
  /** Every image id for the garment, in the new gallery order. A partial list is refused. */
  imageIds: Uuid[];
}

interface ImagesSnapshot {
  previous: AdminGarmentImage[] | undefined;
}

/** D-18 — the drop lands immediately and rolls back cleanly if the write is refused. */
export function useReorderGarmentImages(): UseMutationResult<
  AdminGarmentImage[],
  ApiError,
  ReorderImagesVariables,
  ImagesSnapshot
> {
  const queryClient = useQueryClient();

  return useMutation<AdminGarmentImage[], ApiError, ReorderImagesVariables, ImagesSnapshot>({
    mutationFn: ({ garmentId, imageIds }) => reorderGarmentImages(garmentId, { imageIds }),
    onMutate: async ({ garmentId, imageIds }) => {
      const key = queryKeys.garments.images(garmentId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<AdminGarmentImage[]>(key);
      if (previous) {
        const byId = new Map(previous.map((image) => [image.id, image]));
        const reordered = imageIds
          .map((id) => byId.get(id))
          .filter((image): image is AdminGarmentImage => image !== undefined)
          .map((image, index) => ({ ...image, position: index }));
        queryClient.setQueryData<AdminGarmentImage[]>(key, reordered);
      }
      return { previous };
    },
    onError: (_error, { garmentId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.garments.images(garmentId), context.previous);
      }
    },
    onSuccess: (images, { garmentId }) => {
      queryClient.setQueryData(queryKeys.garments.images(garmentId), images);
    },
  });
}

export interface UpdateImageVariables {
  garmentId: Uuid;
  imageId: Uuid;
  body: UpdateGarmentImageBody;
}

/** Alt text (D-20) and position. Optimistic, because a caption edit should feel like typing. */
export function useUpdateGarmentImage(): UseMutationResult<
  AdminGarmentImage,
  ApiError,
  UpdateImageVariables,
  ImagesSnapshot
> {
  const queryClient = useQueryClient();

  return useMutation<AdminGarmentImage, ApiError, UpdateImageVariables, ImagesSnapshot>({
    mutationFn: ({ imageId, body }) => updateGarmentImage(imageId, body),
    onMutate: async ({ garmentId, imageId, body }) => {
      const key = queryKeys.garments.images(garmentId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<AdminGarmentImage[]>(key);
      if (previous) {
        queryClient.setQueryData<AdminGarmentImage[]>(
          key,
          previous.map((image) => (image.id === imageId ? { ...image, ...body } : image)),
        );
      }
      return { previous };
    },
    onError: (_error, { garmentId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.garments.images(garmentId), context.previous);
      }
    },
    onSettled: (_data, _error, { garmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.images(garmentId) });
    },
  });
}

export interface ImageActionVariables {
  garmentId: Uuid;
  imageId: Uuid;
}

/**
 * A-9. Not optimistic: this call re-runs the A-10 validator and resets the test-render state, so
 * what comes back changes whether the piece can be published. Guessing at that would be worse
 * than waiting for it.
 */
export function useSetTryOnSource(): UseMutationResult<
  GarmentImageWithQuality,
  ApiError,
  ImageActionVariables
> {
  const queryClient = useQueryClient();

  return useMutation<GarmentImageWithQuality, ApiError, ImageActionVariables>({
    mutationFn: ({ imageId }) => setTryOnSource(imageId),
    onSuccess: (_result, { garmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.images(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.lists() });
    },
  });
}

export function useRevalidateGarmentImage(): UseMutationResult<
  ImageQualityReport,
  ApiError,
  ImageActionVariables
> {
  const queryClient = useQueryClient();

  return useMutation<ImageQualityReport, ApiError, ImageActionVariables>({
    mutationFn: ({ imageId }) => revalidateGarmentImage(imageId),
    onSuccess: (_report, { garmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.images(garmentId) });
    },
  });
}

/**
 * Deleting an image is refused while it is the try-on source of a **published** garment: taking
 * a live piece off the catalogue as a side effect of an image edit is not something an image
 * edit gets to do (`INVALID_PUBLISH_TRANSITION`).
 */
export function useDeleteGarmentImage(): UseMutationResult<
  void,
  ApiError,
  ImageActionVariables,
  ImagesSnapshot
> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ImageActionVariables, ImagesSnapshot>({
    mutationFn: ({ imageId }) => deleteGarmentImage(imageId),
    onMutate: async ({ garmentId, imageId }) => {
      const key = queryKeys.garments.images(garmentId);
      await queryClient.cancelQueries({ queryKey: key });

      const previous = queryClient.getQueryData<AdminGarmentImage[]>(key);
      if (previous) {
        queryClient.setQueryData<AdminGarmentImage[]>(
          key,
          previous.filter((image) => image.id !== imageId),
        );
      }
      return { previous };
    },
    onError: (_error, { garmentId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.garments.images(garmentId), context.previous);
      }
    },
    onSettled: (_data, _error, { garmentId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.images(garmentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(garmentId) });
    },
  });
}
