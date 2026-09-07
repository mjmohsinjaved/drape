'use client';

import { useCallback, useMemo, useState } from 'react';

import { ChevronLeft, ChevronRight, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  FileDropzone,
  IconButton,
  ImageCropperDialog,
  Input,
  Skeleton,
  StatusPill,
  TypeToConfirmDialog,
  VisuallyHidden,
  cn,
  toast,
  type UploadFile,
} from '@repo/ui';
import { formatBytes } from '@repo/utils';

import { AdminSection } from '@/features/catalog/components/AdminPage';
import { SignedImage } from '@/features/catalog/components/SignedImage';
import { useCatalogErrorCopy } from '@/features/catalog/hooks/use-catalog-error';
import {
  useDeleteGarmentImage,
  useGarmentImages,
  useReorderGarmentImages,
  useSetTryOnSource,
  useUpdateGarmentImage,
} from '@/features/catalog/hooks/use-garment-images';
import { useGarmentImageUploader } from '@/features/catalog/hooks/use-image-uploader';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_GARMENT_IMAGES,
  MAX_GARMENT_IMAGE_BYTES,
  type AdminGarmentImage,
  type ImageQualityReport,
} from '@/features/catalog/types/admin-catalog';
import { moveWithin } from '@/features/categories/types/admin-categories';
import {
  GARMENT_ASPECT,
  GARMENT_IMAGE_MAX_EDGE,
  GARMENT_IMAGE_MIN_LONG_EDGE,
  GARMENT_IMAGE_OUTPUT_TYPE,
  GARMENT_IMAGE_QUALITY,
  GARMENT_RATIO_LABEL,
} from '@/lib/image-frame';

import type { Uuid } from '@repo/api-client';

interface CropQueue {
  files: File[];
  index: number;
  framed: File[];
}

export interface GarmentImagesPanelProps {
  garmentId: Uuid;
  garmentTitle: string;
  isPublished: boolean;
  initialImages?: AdminGarmentImage[];
  onQualityReport?: (report: ImageQualityReport) => void;
}

export function GarmentImagesPanel({
  garmentId,
  garmentTitle,
  isPublished,
  initialImages,
  onQualityReport,
}: GarmentImagesPanelProps) {
  const t = useTranslations('admin.catalog.images');
  const errorCopy = useCatalogErrorCopy();

  const query = useGarmentImages(garmentId, initialImages);
  const reorder = useReorderGarmentImages();
  const setSource = useSetTryOnSource();
  const updateImage = useUpdateGarmentImage();
  const removeImage = useDeleteGarmentImage();

  const images = useMemo(() => query.data ?? [], [query.data]);
  const hasTryOnSource = images.some((image) => image.isTryOnSource);

  const uploader = useGarmentImageUploader({
    garmentId,
    hasTryOnSource,
    onQualityReport,
  });
  const [cropQueue, setCropQueue] = useState<CropQueue | null>(null);

  const [dragId, setDragId] = useState<Uuid | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<AdminGarmentImage | null>(null);

  const startCropping = useCallback((files: File[]): void => {
    const first = files[0];
    if (!first) return;
    setCropQueue({ files: [first], index: 0, framed: [] });
  }, []);

  const advanceQueue = useCallback(
    (framed: File | null): void => {
      if (cropQueue === null) return;

      const kept = framed === null ? cropQueue.framed : [...cropQueue.framed, framed];
      const index = cropQueue.index + 1;

      if (index < cropQueue.files.length) {
        setCropQueue({ files: cropQueue.files, index, framed: kept });
        return;
      }

      setCropQueue(null);
      if (kept.length > 0) uploader.addFiles(kept);
    },
    [cropQueue, uploader],
  );

  const applyOrder = useCallback(
    async (from: number, to: number): Promise<void> => {
      const ids = images.map((image) => image.id);
      const next = moveWithin(ids, from, to);
      if (next.join() === ids.join()) return;

      try {
        await reorder.mutateAsync({ garmentId, imageIds: next });
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [errorCopy, garmentId, images, reorder],
  );

  const handleSetSource = useCallback(
    async (image: AdminGarmentImage): Promise<void> => {
      try {
        const result = await setSource.mutateAsync({ garmentId, imageId: image.id });
        onQualityReport?.(result.quality);
        toast.success(t('toast.sourceSet'), { description: t('toast.sourceSetHint') });
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [errorCopy, garmentId, onQualityReport, setSource, t],
  );

  const handleAltCommit = useCallback(
    async (image: AdminGarmentImage): Promise<void> => {
      const draft = altDrafts[image.id];
      if (draft === undefined || draft === (image.altText ?? '')) return;

      try {
        await updateImage.mutateAsync({
          garmentId,
          imageId: image.id,
          body: { altText: draft },
        });
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [altDrafts, errorCopy, garmentId, updateImage],
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return;
    try {
      await removeImage.mutateAsync({ garmentId, imageId: pendingDelete.id });
      setPendingDelete(null);
      toast.success(t('toast.deleted'));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
    }
  }, [errorCopy, garmentId, pendingDelete, removeImage, t]);

  const dropzoneFiles: UploadFile[] = uploader.rows.map((row) => ({
    id: row.id,
    name: row.name,
    size: row.size,
    progress: row.progress,
    status:
      row.status === 'done'
        ? 'done'
        : row.status === 'error'
          ? 'error'
          : row.status === 'queued'
            ? 'queued'
            : 'uploading',
    error: row.errorCode ? errorCopy.fromCode(row.errorCode) : undefined,
    previewUrl: row.previewUrl,
    meta:
      row.status === 'finalising' ? (
        <span className="text-xs text-ink-muted">{t('finalising')}</span>
      ) : row.quality ? (
        <span className="text-xs text-ink-muted">
          {t('uploadedQuality', { score: row.quality.score })}
        </span>
      ) : undefined,
  }));

  const atCapacity = images.length >= MAX_GARMENT_IMAGES;
  const isGallery = images.length > 1;

  return (
    <AdminSection
      title={t('sectionTitle')}
      description={t('sectionDescription')}
      actions={
        uploader.rows.some((row) => row.status === 'done') ? (
          <Button variant="ghost" size="sm" onClick={uploader.clearFinished}>
            {t('clearFinished')}
          </Button>
        ) : null
      }
    >
      <FileDropzone
        accept={ACCEPTED_IMAGE_MIME_TYPES.join(',')}
        multiple={false}
        disabled={atCapacity}
        label={t('dropzoneLabel')}
        browseLabel={t('dropzoneBrowse')}
        hint={t('dropzoneHint', { size: formatBytes(MAX_GARMENT_IMAGE_BYTES) })}
        filesLabel={t('uploadsLabel')}
        removeLabel={t('removeUpload')}
        retryLabel={t('retryUpload')}
        doneLabel={t('uploadDone')}
        formatSize={(bytes) => formatBytes(bytes)}
        files={dropzoneFiles}
        onFilesSelected={startCropping}
        onRemoveFile={uploader.removeRow}
        onRetryFile={uploader.retryRow}
      />
      <ImageCropperDialog
        open={cropQueue !== null}
        onOpenChange={(next) => {
          if (!next) advanceQueue(null);
        }}
        file={cropQueue === null ? null : (cropQueue.files[cropQueue.index] ?? null)}
        aspect={GARMENT_ASPECT}
        maxEdge={GARMENT_IMAGE_MAX_EDGE}
        recommendedMinEdge={GARMENT_IMAGE_MIN_LONG_EDGE}
        outputType={GARMENT_IMAGE_OUTPUT_TYPE}
        outputQuality={GARMENT_IMAGE_QUALITY}
        outputBaseName={`${garmentTitle.slice(0, 40)}-${String((cropQueue?.index ?? 0) + 1)}`}
        onConfirm={(result) => {
          advanceQueue(result.file);
        }}
        title={t('crop.title')}
        description={t('crop.description')}
        stepLabel={
          cropQueue === null || cropQueue.files.length < 2
            ? undefined
            : t('crop.step', { position: cropQueue.index + 1, total: cropQueue.files.length })
        }
        aspectLabel={t('crop.aspect', { ratio: GARMENT_RATIO_LABEL })}
        confirmLabel={t('crop.confirm')}
        cancelLabel={
          cropQueue !== null && cropQueue.files.length > 1 ? t('crop.skip') : t('crop.cancel')
        }
        stageLabel={t('crop.stage')}
        zoomLabel={t('crop.zoom')}
        zoomInLabel={t('crop.zoomIn')}
        zoomOutLabel={t('crop.zoomOut')}
        rotateLeftLabel={t('crop.rotateLeft')}
        rotateRightLabel={t('crop.rotateRight')}
        resetLabel={t('crop.reset')}
        hint={t('crop.hint')}
        loadingLabel={t('crop.loading')}
        workingLabel={t('crop.working')}
        formatOutput={(width, height) => t('crop.output', { width, height })}
        belowMinTitle={t('crop.belowMinTitle')}
        belowMinBody={(longEdge, minimum) => t('crop.belowMinBody', { longEdge, minimum })}
        tooSmallTitle={t('crop.tooSmallTitle')}
        tooSmallBody={(longEdge, minimum) => t('crop.tooSmallBody', { longEdge, minimum })}
        decodeFailedTitle={t('crop.decodeFailedTitle')}
        decodeFailedBody={t('crop.decodeFailedBody')}
      />

      {atCapacity ? (
        <Callout tone="info" title={t('atCapacityTitle')}>
          {t('atCapacityBody')}
        </Callout>
      ) : null}

      {query.isError ? (
        <Callout tone="danger" title={t('loadFailedTitle')}>
          {errorCopy.message(query.error)}
        </Callout>
      ) : null}

      {query.isPending ? (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="grid gap-3 sm:max-w-sm"
        >
          <VisuallyHidden>{t('loading')}</VisuallyHidden>
          <Skeleton ratio="garment" className="w-full rounded-md" />
        </div>
      ) : null}

      {!query.isPending && images.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-ink-muted">
          {t('empty')}
        </p>
      ) : null}

      {!hasTryOnSource && images.length > 0 ? (
        <Callout tone="warning" title={t('noSourceTitle')}>
          {t('noSourceBody')}
        </Callout>
      ) : null}

      {images.length > 0 ? (
        <ul className={cn('grid gap-3', isGallery ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:max-w-sm')}>
          {images.map((image, index) => (
            <li
              key={image.id}
              draggable={isGallery}
              onDragStart={() => setDragId(image.id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => {
                if (dragId === null || dragId === image.id) return;
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId === null) return;
                const from = images.findIndex((candidate) => candidate.id === dragId);
                setDragId(null);
                if (from === -1) return;
                void applyOrder(from, index);
              }}
              className={cn(
                'flex flex-col gap-2 rounded-md border border-line bg-surface p-2',
                image.isTryOnSource && 'border-brand bg-brand-tint',
                dragId === image.id && 'opacity-50',
              )}
            >
              <SignedImage
                src={image.thumbnailUrl ?? image.url}
                alt={image.altText ?? ''}
                ratio="garment"
                rounded="xs"
                sizes="(min-width: 1024px) 20vw, (min-width: 640px) 40vw, 90vw"
                fallbackLabel={t('imageUnavailable')}
                emptyLabel={t('noImage')}
              />

              <div className="flex items-center justify-between gap-2">
                {image.isTryOnSource ? (
                  <StatusPill size="sm" tone="brand" srPrefix={t('roleLabel')}>
                    {t('tryOnSource')}
                  </StatusPill>
                ) : (
                  <StatusPill size="sm" tone="neutral" srPrefix={t('roleLabel')} dot={false}>
                    {t('galleryImage')}
                  </StatusPill>
                )}
                <span className="text-2xs text-ink-subtle">
                  {t('dimensions', { width: image.width, height: image.height })}
                </span>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-2xs font-medium text-ink-muted">{t('altLabel')}</span>
                <Input
                  value={altDrafts[image.id] ?? image.altText ?? ''}
                  placeholder={t('altPlaceholder')}
                  onChange={(event) =>
                    setAltDrafts((current) => ({ ...current, [image.id]: event.target.value }))
                  }
                  onBlur={() => void handleAltCommit(image)}
                />
              </label>

              <div className="flex flex-wrap items-center gap-1">
                {isGallery ? (
                  <>
                    <IconButton
                      size="sm"
                      label={t('actions.moveEarlier', { position: index + 1 })}
                      icon={<ChevronLeft />}
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => void applyOrder(index, index - 1)}
                    />
                    <IconButton
                      size="sm"
                      label={t('actions.moveLater', { position: index + 1 })}
                      icon={<ChevronRight />}
                      disabled={index === images.length - 1 || reorder.isPending}
                      onClick={() => void applyOrder(index, index + 1)}
                    />
                  </>
                ) : null}
                {!image.isTryOnSource ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    startIcon={<Star aria-hidden="true" className="size-4" />}
                    loading={setSource.isPending}
                    loadingLabel={t('actions.setSource')}
                    onClick={() => void handleSetSource(image)}
                  >
                    {t('actions.setSource')}
                  </Button>
                ) : null}
                <IconButton
                  size="sm"
                  variant="danger"
                  label={t('actions.delete', { position: index + 1 })}
                  icon={<Trash2 />}
                  disabled={image.isTryOnSource && isPublished}
                  onClick={() => setPendingDelete(image)}
                />
              </div>

              {image.isTryOnSource && isPublished ? (
                <p className="text-2xs text-ink-muted">{t('cannotDeleteLiveSource')}</p>
              ) : null}

              <VisuallyHidden>{t('position', { position: index + 1 })}</VisuallyHidden>
            </li>
          ))}
        </ul>
      ) : null}

      {pendingDelete ? (
        <TypeToConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title={t('deleteDialog.title')}
          description={
            pendingDelete.isTryOnSource
              ? t('deleteDialog.sourceBody', { title: garmentTitle })
              : t('deleteDialog.body', { title: garmentTitle })
          }
          confirmLabel={t('deleteDialog.confirm')}
          cancelLabel={t('deleteDialog.cancel')}
          confirmationText={garmentTitle}
          confirmationPrompt={t('deleteDialog.typePrompt')}
          confirmationMismatchHint={t('deleteDialog.mismatch')}
          loading={removeImage.isPending}
          onConfirm={handleDelete}
        />
      ) : null}
    </AdminSection>
  );
}
