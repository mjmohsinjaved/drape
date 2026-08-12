'use client';

import { useCallback, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import {
  Button,
  ErrorState,
  PermissionDeniedState,
  Skeleton,
  TypeToConfirmDialog,
  VisuallyHidden,
  toast,
} from '@repo/ui';

import { SignedOutState } from '@/components/states';
import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import { PublishStatePill, QualityPill } from '@/features/catalog/components/CatalogPills';
import { GarmentForm } from '@/features/catalog/components/GarmentForm';
import { GarmentImagesPanel } from '@/features/catalog/components/GarmentImagesPanel';
import {
  isPermissionDenied,
  isSignedOut,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import {
  useDeleteGarment,
  useGarment,
  useUpdateGarment,
} from '@/features/catalog/hooks/use-garments';
import {
  formToUpdateBody,
  garmentToForm,
  type GarmentFormValues,
} from '@/features/catalog/schemas/garment-form';
import {
  DEFAULT_QUALITY_MIN_SCORE,
  type AdminGarment,
  type AdminGarmentImage,
  type ImageQualityReport,
} from '@/features/catalog/types/admin-catalog';
import { routes } from '@/lib/routes';

import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { Locale } from '@/i18n/config';
import type { Uuid } from '@repo/api-client';

export interface GarmentEditorScreenProps {
  locale: Locale;
  garmentId: Uuid;
  categories: AdminCategory[];
  initialGarment?: AdminGarment;
  initialImages?: AdminGarmentImage[];
}

/**
 * One piece: the record and its gallery, on one screen because they are one job.
 *
 * The one-step flow (2026-08) removed the publish/test-render/quality panels that used to sit
 * beside the form — a piece is published the moment it is created, so there is no workflow left
 * to draw. What remains is editing, the gallery, and deletion.
 *
 * The form is optimistic (D-18) — a saved title lands immediately and rolls back with a reason
 * if the API refuses it.
 */
export function GarmentEditorScreen({
  locale,
  garmentId,
  categories,
  initialGarment,
  initialImages,
}: GarmentEditorScreenProps) {
  const t = useTranslations('admin.catalog.editor');
  const tPublish = useTranslations('admin.catalog.publish');
  const errorCopy = useCatalogErrorCopy();
  const router = useRouter();

  const query = useGarment(garmentId, initialGarment);
  const updateGarment = useUpdateGarment();
  const removeGarment = useDeleteGarment();

  const [values, setValues] = useState<GarmentFormValues | null>(
    initialGarment ? garmentToForm(initialGarment) : null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [liveQuality, setLiveQuality] = useState<ImageQualityReport | null>(null);

  const garment = query.data;

  // Seed the form the first time the record arrives, and never again: re-seeding on every
  // refetch would throw away whatever the admin is halfway through typing.
  if (garment && values === null) {
    setValues(garmentToForm(garment));
  }

  const handleSave = useCallback(async (): Promise<void> => {
    if (!values) return;
    try {
      const saved = await updateGarment.mutateAsync({
        garmentId,
        body: formToUpdateBody(values),
      });
      toast.success(t('toast.saved', { title: saved.title }));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error), { description: t('toast.rolledBack') });
    }
  }, [errorCopy, garmentId, t, updateGarment, values]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!garment) return;
    try {
      await removeGarment.mutateAsync({ garmentId: garment.id, confirmTitle: garment.title });
      setDeleteOpen(false);
      toast.success(tPublish('toast.deleted', { title: garment.title }));
      router.push(routes.admin.catalog(locale));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
    }
  }, [errorCopy, garment, locale, removeGarment, router, tPublish]);

  /* ---------------------------------------------------------------- D-5 states */

  if (query.isPending || values === null) {
    return (
      <AdminPage>
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-4">
          <VisuallyHidden>{t('loading')}</VisuallyHidden>
          <Skeleton className="h-8 w-64 rounded-sm" />
          <Skeleton className="h-64 w-full rounded-md" />
          <Skeleton className="h-48 w-full rounded-md" />
        </div>
      </AdminPage>
    );
  }

  if (query.isError || !garment) {
    return (
      <AdminPage>
        {/* A session that ended is not an authorisation refusal — it has its own screen. */}
        {isSignedOut(query.error) ? (
          <SignedOutState />
        ) : isPermissionDenied(query.error) ? (
          <PermissionDeniedState />
        ) : (
          <ErrorState
            title={t('error.title')}
            description={errorCopy.message(query.error)}
            onRetry={() => void query.refetch()}
            retryLabel={t('error.retry')}
            retrying={query.isFetching}
            secondaryAction={
              <Button asChild variant="secondary">
                <Link href={routes.admin.catalog(locale)}>{t('error.back')}</Link>
              </Button>
            }
          />
        )}
      </AdminPage>
    );
  }

  const score = liveQuality?.score ?? garment.qualityScore;
  const minScore = liveQuality?.minScore ?? DEFAULT_QUALITY_MIN_SCORE;

  return (
    <AdminPage>
      <AdminPageHeader
        title={garment.title}
        description={t('description', { sku: garment.sku })}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
              {tPublish('actions.delete')}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={routes.admin.catalog(locale)}>{t('backToList')}</Link>
            </Button>
          </>
        }
        meta={
          <>
            <PublishStatePill state={garment.publishState} />
            <QualityPill score={score} minScore={minScore} overridden={garment.qualityOverridden} />
          </>
        }
      />

      <div className="flex flex-col gap-stack">
        <GarmentForm
          values={values}
          onChange={setValues}
          categories={categories}
          onSubmit={handleSave}
          submitLabel={t('save')}
          saving={updateGarment.isPending}
        />

        <GarmentImagesPanel
          garmentId={garment.id}
          garmentTitle={garment.title}
          isPublished={garment.publishState === 'PUBLISHED'}
          initialImages={initialImages}
          onQualityReport={setLiveQuality}
        />
      </div>

      <TypeToConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={tPublish('deleteDialog.title', { title: garment.title })}
        description={tPublish('deleteDialog.body')}
        confirmLabel={tPublish('deleteDialog.confirm')}
        cancelLabel={tPublish('deleteDialog.cancel')}
        confirmationText={garment.title}
        confirmationPrompt={tPublish('deleteDialog.typePrompt')}
        confirmationMismatchHint={tPublish('deleteDialog.mismatch')}
        loading={removeGarment.isPending}
        onConfirm={handleDelete}
      />
    </AdminPage>
  );
}
