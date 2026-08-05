'use client';

import { useCallback, useMemo, useState } from 'react';

import { ChevronLeft, ChevronRight, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  FileDropzone,
  IconButton,
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
  MAX_GALLERY_IMAGES,
  MAX_GARMENT_IMAGE_BYTES,
  type AdminGarmentImage,
  type ImageQualityReport,
} from '@/features/catalog/types/admin-catalog';
import { moveWithin } from '@/features/categories/types/admin-categories';

import type { Uuid } from '@repo/api-client';

export interface GarmentImagesPanelProps {
  garmentId: Uuid;
  garmentTitle: string;
  /** True when the garment is live — deleting its try-on source is refused while it is. */
  isPublished: boolean;
  initialImages?: AdminGarmentImage[];
  /** Bubbles the A-10 verdict up so the editor can show the report without a second fetch. */
  onQualityReport?: (report: ImageQualityReport) => void;
}

/**
 * A-9 — the gallery.
 *
 * > "Drag-and-drop, multiple files, per-file progress. One image is designated the try-on source;
 * > the rest are the gallery. Reorder and delete."
 *
 * **Per-file progress** comes from the uploader hook running the three §3.5 steps once per file;
 * `FileDropzone` draws a row and a bar for each, and a failed file keeps its own message and its
 * own retry (D-16).
 *
 * **Reorder is not mouse-only.** Cards are draggable for a pointer, and every card also carries
 * Move earlier / Move later buttons that perform the same mutation. Both send the complete
 * ordering, which is what the API expects.
 *
 * **Designating a try-on source has a consequence**, and the panel says so before it happens: it
 * resets the test render to none, which makes the piece unpublishable until a fresh render is
 * approved (A-11).
 */
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

  const [dragId, setDragId] = useState<Uuid | null>(null);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<AdminGarmentImage | null>(null);

  const applyOrder = useCallback(
    async (from: number, to: number): Promise<void> => {
      const ids = images.map((image) => image.id);
      const next = moveWithin(ids, from, to);
      if (next.join() === ids.join()) return;

      try {
        await reorder.mutateAsync({ garmentId, imageIds: next });
      } catch (error: unknown) {
        // The optimistic move has already been rolled back by the hook (D-18).
        toast.error(errorCopy.fromError(error));
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
        toast.error(errorCopy.fromError(error));
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
        toast.error(errorCopy.fromError(error));
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
      toast.error(errorCopy.fromError(error));
    }
  }, [errorCopy, garmentId, pendingDelete, removeImage, t]);

  /** The uploader's rows, in the shape `FileDropzone` draws. */
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

  const atCapacity = images.length >= MAX_GALLERY_IMAGES;

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
        multiple
        disabled={atCapacity}
        label={t('dropzoneLabel')}
        browseLabel={t('dropzoneBrowse')}
        hint={t('dropzoneHint', {
          size: formatBytes(MAX_GARMENT_IMAGE_BYTES),
          max: MAX_GALLERY_IMAGES,
        })}
        filesLabel={t('uploadsLabel')}
        removeLabel={t('removeUpload')}
        retryLabel={t('retryUpload')}
        formatSize={(bytes) => formatBytes(bytes)}
        files={dropzoneFiles}
        onFilesSelected={uploader.addFiles}
        onRemoveFile={uploader.removeRow}
        onRetryFile={uploader.retryRow}
      />

      {atCapacity ? (
        <Callout tone="info" title={t('atCapacityTitle')}>
          {t('atCapacityBody', { max: MAX_GALLERY_IMAGES })}
        </Callout>
      ) : null}

      {query.isError ? (
        <Callout tone="danger" title={t('loadFailedTitle')}>
          {errorCopy.fromError(query.error)}
        </Callout>
      ) : null}

      {query.isPending ? (
        // Aspect-matched to the cards below, so nothing jumps when the gallery lands (D-8).
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <VisuallyHidden>{t('loading')}</VisuallyHidden>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} ratio="garment" className="w-full rounded-md" />
          ))}
        </div>
      ) : null}

      {!query.isPending && images.length === 0 ? (
        // The panel's own empty state: it names the next action rather than the absence (D-6).
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
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <li
              key={image.id}
              draggable
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
