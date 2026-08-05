'use client';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  Button,
  ErrorState,
  PermissionDeniedState,
  Skeleton,
  VisuallyHidden,
  toast,
} from '@repo/ui';

import { SignedOutState } from '@/components/states';
import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import { PublishStatePill, QualityPill } from '@/features/catalog/components/CatalogPills';
import { GarmentForm } from '@/features/catalog/components/GarmentForm';
import { GarmentImagesPanel } from '@/features/catalog/components/GarmentImagesPanel';
import { PublishPanel } from '@/features/catalog/components/PublishPanel';
import { QualityOverrideDialog } from '@/features/catalog/components/QualityOverrideDialog';
import { QualityReport } from '@/features/catalog/components/QualityReport';
import {
  isPermissionDenied,
  isSignedOut,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import {
  useGarmentImages,
  useRevalidateGarmentImage,
} from '@/features/catalog/hooks/use-garment-images';
import {
  useGarment,
  useOverrideQuality,
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
import { Link } from '@/i18n/navigation';
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
 * A-8 through A-11 for one piece: the record, its gallery, its A-10 report and its publish gate,
 * on one screen because they are one job.
 *
 * The form is optimistic (D-18) — a saved title lands immediately and rolls back with a reason if
 * the API refuses it. The publish gate deliberately is not: it is decided server-side, and
 * showing "Published" for a moment before snapping back would be the interface lying about the
 * one transition an admin most needs to trust.
 */
export function GarmentEditorScreen({
  locale,
  garmentId,
  categories,
  initialGarment,
  initialImages,
}: GarmentEditorScreenProps) {
  const t = useTranslations('admin.catalog.editor');
  const errorCopy = useCatalogErrorCopy();

  const query = useGarment(garmentId, initialGarment);
  const imagesQuery = useGarmentImages(garmentId, initialImages);
  const updateGarment = useUpdateGarment();
  const overrideQuality = useOverrideQuality();
  const revalidate = useRevalidateGarmentImage();

  const [values, setValues] = useState<GarmentFormValues | null>(
    initialGarment ? garmentToForm(initialGarment) : null,
  );
  const [overrideOpen, setOverrideOpen] = useState(false);
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

  const handleOverride = useCallback(
    async (reason: string): Promise<void> => {
      try {
        await overrideQuality.mutateAsync({ garmentId, reason });
        setOverrideOpen(false);
        toast.success(t('toast.overrideRecorded'));
      } catch (error: unknown) {
        toast.error(errorCopy.message(error));
      }
    },
    [errorCopy, garmentId, overrideQuality, t],
  );

  const images = imagesQuery.data ?? [];
  const tryOnSource = images.find((image) => image.isTryOnSource) ?? null;

  const handleRevalidate = useCallback(async (): Promise<void> => {
    if (!tryOnSource) return;
    try {
      const report = await revalidate.mutateAsync({ garmentId, imageId: tryOnSource.id });
      setLiveQuality(report);
      toast.success(t('toast.revalidated', { score: report.score }));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
    }
  }, [errorCopy, garmentId, revalidate, t, tryOnSource]);

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
  const checks = liveQuality?.checks ?? garment.qualityChecks;

  return (
    <AdminPage>
      <AdminPageHeader
        title={garment.title}
        description={t('description', { sku: garment.sku })}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={routes.admin.garmentTestRender(locale, garment.id)}>
                {t('testRenderLink')}
              </Link>
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

      <div className="grid gap-stack xl:grid-cols-3">
        <div className="flex flex-col gap-stack xl:col-span-2">
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

        <div className="flex flex-col gap-stack">
          <PublishPanel locale={locale} garment={garment} hasTryOnSource={tryOnSource !== null} />

          <QualityReport
            score={score}
            minScore={minScore}
            checks={checks}
            overridden={garment.qualityOverridden}
            overriddenAt={garment.qualityOverriddenAt}
            onOverride={() => setOverrideOpen(true)}
            onRevalidate={tryOnSource ? () => void handleRevalidate() : undefined}
            revalidating={revalidate.isPending}
          />
        </div>
      </div>

      {score !== null ? (
        <QualityOverrideDialog
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          garmentTitle={garment.title}
          score={score}
          minScore={minScore}
          failedChecks={checks.filter((check) => !check.passed).length}
          onConfirm={handleOverride}
          saving={overrideQuality.isPending}
        />
      ) : null}
    </AdminPage>
  );
}
