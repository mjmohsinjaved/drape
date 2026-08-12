'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { queryKeys } from '@repo/api-client';
import { Button, EmptyState, FileDropzone, toast, type UploadFile } from '@repo/ui';
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
  MAX_GALLERY_IMAGES,
  MAX_GARMENT_IMAGE_BYTES,
} from '@/features/catalog/types/admin-catalog';
import { routes } from '@/lib/routes';

import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { Locale } from '@/i18n/config';

/** A photograph chosen before the piece exists — uploaded right after the create returns. */
interface PendingPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

let photoCounter = 0;

export interface NewGarmentScreenProps {
  locale: Locale;
  categories: AdminCategory[];
}

/**
 * A-8 — creating a piece, the one-step flow (2026-08).
 *
 * Details and photographs on one form, and the save is the publish: `POST /admin/garments`
 * creates the piece already live, then each chosen photograph runs the three §3.5 upload steps
 * against the new id (a ticket is scoped to a garment id, which is why the uploads cannot start
 * before the create returns). The first photograph claims the try-on source role.
 *
 * If a photograph fails after the piece is created, the piece is still live — the toast says so
 * and the editor's gallery offers the retry, rather than pretending the whole save failed.
 *
 * With no categories there is nothing to create against — `categoryId` is required — so the
 * screen shows the way to make one instead of a form that cannot be submitted (D-6).
 */
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
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const photosRef = useRef<PendingPhoto[]>([]);
  photosRef.current = photos;
  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

  const addPhotos = useCallback((files: File[]): void => {
    setPhotos((current) => [
      ...current,
      ...files.map((file) => {
        photoCounter += 1;
        return {
          id: `pending-${String(photoCounter)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        };
      }),
    ]);
  }, []);

  const removePhoto = useCallback((photoId: string): void => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.id !== photoId);
    });
  }, []);

  const handleSubmit = async (): Promise<void> => {
    setSaving(true);
    try {
      const created = await createGarment.mutateAsync(formToCreateBody(values));

      // Serial on purpose — the file routes are rate-limited (§5.22) and serial keeps
      // gallery position matching the order the photographs were chosen.
      const failed: string[] = [];
      for (const [index, photo] of photos.entries()) {
        try {
          const ticket = await createUploadTicket({
            purpose: 'GARMENT_IMAGE',
            contentType: photo.file.type,
            byteSize: photo.file.size,
            ownerId: created.id,
          });
          const uploaded = await redeemUploadTicket(ticket, photo.file, {});
          await createGarmentImage(created.id, {
            key: uploaded.key,
            // The first photograph is the try-on source; without one every try-on
            // against the live piece fails at generation time.
            isTryOnSource: index === 0,
          });
        } catch {
          failed.push(photo.file.name);
        }
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.images(created.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garments.detail(created.id) });

      if (failed.length > 0) {
        toast.error(t('toast.imagesFailed', { count: failed.length }), {
          description: failed.join(', '),
        });
        // The piece is live either way; land on its gallery, where the retry lives.
        router.push(routes.admin.garment(locale, created.id));
        return;
      }

      toast.success(t('toast.created', { title: created.title }), {
        description: t('toast.createdHint'),
      });
      router.push(routes.admin.catalog(locale));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
      setSaving(false);
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

  const dropzoneFiles: UploadFile[] = photos.map((photo) => ({
    id: photo.id,
    name: photo.file.name,
    size: photo.file.size,
    status: 'queued',
    progress: 0,
  }));

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
      />

      <AdminSection title={tImages('sectionTitle')} description={t('photosOnCreate')}>
        <FileDropzone
          accept={ACCEPTED_IMAGE_MIME_TYPES.join(',')}
          multiple
          disabled={saving}
          onFilesSelected={addPhotos}
          files={dropzoneFiles}
          onRemoveFile={removePhoto}
          label={tImages('dropzoneLabel')}
          hint={tImages('dropzoneHint', {
            size: formatBytes(MAX_GARMENT_IMAGE_BYTES),
            max: MAX_GALLERY_IMAGES,
          })}
          browseLabel={tImages('dropzoneBrowse')}
          removeLabel={tImages('removeUpload')}
          filesLabel={tImages('uploadsLabel')}
          formatSize={formatBytes}
        />

        {photos.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((photo, index) => (
              <li key={photo.id} className="flex flex-col gap-1">
                <span className="relative block aspect-card w-full overflow-hidden rounded-sm border border-line bg-surface-sunken">
                  {/* A local object URL for a file not yet uploaded — nothing to optimise. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob: preview of an unuploaded file. */}
                  <img src={photo.previewUrl} alt="" className="size-full object-cover" />
                </span>
                <span className="truncate text-xs text-ink-muted">
                  {index === 0 ? tImages('tryOnSource') : photo.file.name}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </AdminSection>
    </AdminPage>
  );
}
