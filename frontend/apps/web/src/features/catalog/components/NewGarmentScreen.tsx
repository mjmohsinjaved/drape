'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useQueryClient } from '@tanstack/react-query';
import { Crop, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { queryKeys, type Uuid } from '@repo/api-client';
import { Button, EmptyState, FileDropzone, ImageCropperDialog, ProgressBar, toast } from '@repo/ui';
import { formatBytes } from '@repo/utils';

import {
  createGarmentImage,
  createUploadTicket,
  redeemUploadTicket,
} from '@/features/catalog/api/endpoints';
import { AdminPage, AdminPageHeader, AdminSection } from '@/features/catalog/components/AdminPage';
import { GarmentForm } from '@/features/catalog/components/GarmentForm';
import { useCatalogErrorCopy } from '@/features/catalog/hooks/use-catalog-error';
import { useCreateGarment } from '@/features/catalog/hooks/use-garments';
import {
  emptyGarmentForm,
  formToCreateBody,
  type GarmentFormValues,
} from '@/features/catalog/schemas/garment-form';
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_GARMENT_IMAGE_BYTES,
} from '@/features/catalog/types/admin-catalog';
import {
  GARMENT_ASPECT,
  GARMENT_IMAGE_MAX_EDGE,
  GARMENT_IMAGE_MIN_LONG_EDGE,
  GARMENT_IMAGE_OUTPUT_TYPE,
  GARMENT_IMAGE_QUALITY,
  GARMENT_RATIO_LABEL,
} from '@/lib/image-frame';
import { routes } from '@/lib/routes';

import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { Locale } from '@/i18n/config';

interface PendingPhoto {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}

type SavePhase = 'idle' | 'creating' | 'uploading' | 'finalising';

export interface NewGarmentScreenProps {
  locale: Locale;
  categories: AdminCategory[];
}

export function NewGarmentScreen({ locale, categories }: NewGarmentScreenProps) {
  const t = useTranslations('admin.catalog.new');
  const tImages = useTranslations('admin.catalog.images');
  const errorCopy = useCatalogErrorCopy();
  const router = useRouter();
  const queryClient = useQueryClient();

  const createGarment = useCreateGarment();
  const selectable = categories.filter((category) => !category.archived);

  const [values, setValues] = useState<GarmentFormValues>(() =>
    emptyGarmentForm(selectable[0]?.id ?? ''),
  );
  const [photo, setPhoto] = useState<PendingPhoto | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [cropping, setCropping] = useState(false);

  const [phase, setPhase] = useState<SavePhase>('idle');
  const [progress, setProgress] = useState(0);

  const photoRef = useRef<PendingPhoto | null>(null);
  photoRef.current = photo;
  useEffect(
    () => () => {
      if (photoRef.current !== null) URL.revokeObjectURL(photoRef.current.previewUrl);
    },
    [],
  );

  const saving = phase !== 'idle';

  const onCropConfirmed = useCallback(
    (result: { file: File; width: number; height: number }): void => {
      setCropping(false);
      setPhoto((current) => {
        if (current !== null) URL.revokeObjectURL(current.previewUrl);
        return {
          file: result.file,
          previewUrl: URL.createObjectURL(result.file),
          width: result.width,
          height: result.height,
        };
      });
    },
    [],
  );

  const onCropDismissed = useCallback((): void => {
    setCropping(false);
    if (photoRef.current === null) setSourceFile(null);
  }, []);

  const removePhoto = useCallback((): void => {
    setPhoto((current) => {
      if (current !== null) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setSourceFile(null);
  }, []);

  const handleSubmit = async (): Promise<void> => {
    if (photo === null) return;

    setPhase('creating');
    setProgress(0);

    let createdId: Uuid | null = null;
    try {
      const created = await createGarment.mutateAsync(formToCreateBody(values));
      createdId = created.id;

      setPhase('uploading');
      const ticket = await createUploadTicket({
        purpose: 'GARMENT_IMAGE',
        contentType: photo.file.type,
        byteSize: photo.file.size,
        ownerId: created.id,
      });
      const uploaded = await redeemUploadTicket(ticket, photo.file, {
        onProgress: setProgress,
      });

      setPhase('finalising');
      await createGarmentImage(created.id, {
        key: uploaded.key,
        isTryOnSource: true,
      });

      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.images(created.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(created.id) });

      toast.success(t('toast.created', { title: created.title }));
      router.push(routes.admin.catalog(locale));
    } catch (error: unknown) {
      setPhase('idle');
      setProgress(0);

      if (createdId === null) {
        toast.error(errorCopy.message(error));
        return;
      }
      toast.error(t('toast.imageFailed'), { description: errorCopy.message(error) });
      router.push(routes.admin.garment(locale, createdId));
    }
  };

  if (selectable.length === 0) {
    return (
      <AdminPage>
        <AdminPageHeader title={t('title')} description={t('description')} />
        <EmptyState
          title={t('noCategories.title')}
          description={t('noCategories.body')}
          action={
            <Button asChild>
              <Link href={routes.admin.categories(locale)}>{t('noCategories.action')}</Link>
            </Button>
          }
        />
      </AdminPage>
    );
  }

  const photoSection = (
    <AdminSection
      title={tImages('sectionTitle')}
      description={t('photosOnCreate', { ratio: GARMENT_RATIO_LABEL })}
    >
      <FileDropzone
        accept={ACCEPTED_IMAGE_MIME_TYPES.join(',')}
        multiple={false}
        disabled={saving}
        files={[]}
        onFilesSelected={(files) => {
          const file = files[0];
          if (!file) return;
          setSourceFile(file);
          setCropping(true);
        }}
        label={photo === null ? t('photo.choose') : t('photo.replace')}
        browseLabel={tImages('dropzoneBrowse')}
        hint={t('photo.hint', {
          size: formatBytes(MAX_GARMENT_IMAGE_BYTES),
          ratio: GARMENT_RATIO_LABEL,
        })}
      />

      {photo === null ? null : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="aspect-card w-40 shrink-0 overflow-hidden rounded-md border border-line bg-surface-sunken">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob: or short-lived signed URL; the optimiser must not touch it. */}
            <img src={photo.previewUrl} alt="" className="size-full object-cover" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm tabular-nums text-ink">
              {tImages('dimensions', { width: photo.width, height: photo.height })}
              <span className="text-ink-subtle"> · {formatBytes(photo.file.size)}</span>
            </p>

            {Math.max(photo.width, photo.height) < GARMENT_IMAGE_MIN_LONG_EDGE ? (
              <p className="text-xs text-warning">
                {t('photo.belowMin', { minimum: GARMENT_IMAGE_MIN_LONG_EDGE })}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={saving}
                startIcon={<Crop aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setCropping(true);
                }}
              >
                {t('photo.reframe')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                startIcon={<Trash2 aria-hidden="true" className="size-4" />}
                onClick={removePhoto}
              >
                {t('photo.remove')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'idle' ? null : (
        <ProgressBar
          value={phase === 'creating' ? null : phase === 'uploading' ? progress : 100}
          tone={phase === 'finalising' ? 'success' : 'brand'}
          label={t(`photo.phase.${phase}`)}
          showLabel
        />
      )}
    </AdminSection>
  );

  return (
    <AdminPage>
      <AdminPageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={routes.admin.catalog(locale)}>{t('cancel')}</Link>
          </Button>
        }
      />

      <GarmentForm
        values={values}
        onChange={setValues}
        categories={selectable}
        onSubmit={handleSubmit}
        submitLabel={t('save')}
        saving={saving}
        beforeActions={photoSection}
        extraRequirements={[{ met: photo !== null, label: t('outstanding.photo') }]}
      />

      <ImageCropperDialog
        open={cropping}
        onOpenChange={onCropDismissed}
        file={sourceFile}
        aspect={GARMENT_ASPECT}
        maxEdge={GARMENT_IMAGE_MAX_EDGE}
        recommendedMinEdge={GARMENT_IMAGE_MIN_LONG_EDGE}
        outputType={GARMENT_IMAGE_OUTPUT_TYPE}
        outputQuality={GARMENT_IMAGE_QUALITY}
        outputBaseName={values.sku.trim() === '' ? 'garment' : values.sku.trim().slice(0, 40)}
        onConfirm={onCropConfirmed}
        title={tImages('crop.title')}
        description={tImages('crop.description')}
        aspectLabel={tImages('crop.aspect', { ratio: GARMENT_RATIO_LABEL })}
        confirmLabel={tImages('crop.confirm')}
        cancelLabel={tImages('crop.cancel')}
        stageLabel={tImages('crop.stage')}
        zoomLabel={tImages('crop.zoom')}
        zoomInLabel={tImages('crop.zoomIn')}
        zoomOutLabel={tImages('crop.zoomOut')}
        rotateLeftLabel={tImages('crop.rotateLeft')}
        rotateRightLabel={tImages('crop.rotateRight')}
        resetLabel={tImages('crop.reset')}
        hint={tImages('crop.hint')}
        loadingLabel={tImages('crop.loading')}
        workingLabel={tImages('crop.working')}
        formatOutput={(width, height) => tImages('crop.output', { width, height })}
        belowMinTitle={tImages('crop.belowMinTitle')}
        belowMinBody={(longEdge, minimum) => tImages('crop.belowMinBody', { longEdge, minimum })}
        tooSmallTitle={tImages('crop.tooSmallTitle')}
        tooSmallBody={(longEdge, minimum) => tImages('crop.tooSmallBody', { longEdge, minimum })}
        decodeFailedTitle={tImages('crop.decodeFailedTitle')}
        decodeFailedBody={tImages('crop.decodeFailedBody')}
      />
    </AdminPage>
  );
}
