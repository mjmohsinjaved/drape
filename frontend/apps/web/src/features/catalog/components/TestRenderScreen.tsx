'use client';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  EmptyState,
  ErrorState,
  FormControl,
  FormError,
  FormField,
  FormHint,
  FormLabel,
  PermissionDeniedState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  VisuallyHidden,
  Zoomable,
  toast,
} from '@repo/ui';

import {
  AdminDensityScope,
  AdminPageHeader,
  AdminSection,
} from '@/features/catalog/components/AdminPage';
import { PublishStatePill, TestRenderStatePill } from '@/features/catalog/components/CatalogPills';
import { SignedImage } from '@/features/catalog/components/SignedImage';
import {
  isPermissionDenied,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import { useGarment } from '@/features/catalog/hooks/use-garments';
import {
  useApproveTestRender,
  useReferenceModels,
  useRejectTestRender,
  useRunTestRender,
  useTestRender,
} from '@/features/catalog/hooks/use-test-render';
import {
  MAX_REJECT_REASON_LENGTH,
  type AdminGarment,
  type ReferenceModel,
  type TestRender,
} from '@/features/catalog/types/admin-catalog';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { Uuid } from '@repo/api-client';

export interface TestRenderScreenProps {
  locale: Locale;
  garmentId: Uuid;
  initialGarment?: AdminGarment;
  initialTestRender?: TestRender;
  initialReferenceModels?: ReferenceModel[];
}

const DEFAULT_MODEL = '__default__';

/**
 * A-11 — the approval screen.
 *
 * > "The result is shown beside the source image for approval and stored on the garment. A
 * > garment cannot be published without an approved test render."
 *
 * Source and render sit side by side at equal size, both zoomable, because the judgement being
 * made is a comparison: does the model put this fabric on a body plausibly enough to shortlist
 * from. Approving unblocks publishing; rejecting requires a written reason, because an admin
 * coming back a week later needs to know whether the photograph was wrong or the render was.
 *
 * The reference model is the only person image an admin ever sends upstream. A consumer photo is
 * never used for a test render (S-10), which is why this screen's picker reads from
 * `GET /admin/reference-models` and has no other source.
 */
export function TestRenderScreen({
  locale,
  garmentId,
  initialGarment,
  initialTestRender,
  initialReferenceModels,
}: TestRenderScreenProps) {
  const t = useTranslations('admin.catalog.testRender');
  const errorCopy = useCatalogErrorCopy();

  const garmentQuery = useGarment(garmentId, initialGarment);
  const renderQuery = useTestRender(garmentId, initialTestRender);
  const modelsQuery = useReferenceModels(initialReferenceModels);

  const runRender = useRunTestRender();
  const approve = useApproveTestRender();
  const reject = useRejectTestRender();

  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);

  const handleRun = useCallback(async (): Promise<void> => {
    try {
      await runRender.mutateAsync({
        garmentId,
        ...(modelId === DEFAULT_MODEL ? {} : { referenceModelId: modelId }),
      });
      toast.success(t('toast.ran'));
    } catch (error: unknown) {
      toast.error(errorCopy.fromError(error));
    }
  }, [errorCopy, garmentId, modelId, runRender, t]);

  const handleApprove = useCallback(async (): Promise<void> => {
    try {
      await approve.mutateAsync({ garmentId });
      toast.success(t('toast.approved'), { description: t('toast.approvedHint') });
    } catch (error: unknown) {
      toast.error(errorCopy.fromError(error));
    }
  }, [approve, errorCopy, garmentId, t]);

  const handleReject = useCallback(async (): Promise<void> => {
    setReasonTouched(true);
    if (reason.trim() === '') return;
    try {
      await reject.mutateAsync({ garmentId, reason: reason.trim() });
      setRejecting(false);
      setReason('');
      toast.success(t('toast.rejected'));
    } catch (error: unknown) {
      toast.error(errorCopy.fromError(error));
    }
  }, [errorCopy, garmentId, reason, reject, t]);

  /* ---------------------------------------------------------------- D-5 states */

  if (garmentQuery.isPending || renderQuery.isPending) {
    return (
      <AdminDensityScope>
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-4">
          <VisuallyHidden>{t('loading')}</VisuallyHidden>
          <Skeleton className="h-8 w-64 rounded-sm" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton ratio="garment" className="w-full rounded-md" />
            <Skeleton ratio="garment" className="w-full rounded-md" />
          </div>
        </div>
      </AdminDensityScope>
    );
  }

  if (garmentQuery.isError || renderQuery.isError) {
    const error = garmentQuery.error ?? renderQuery.error;
    return (
      <AdminDensityScope>
        {isPermissionDenied(error) ? (
          <PermissionDeniedState />
        ) : (
          <ErrorState
            title={t('error.title')}
            description={errorCopy.fromError(error)}
            onRetry={() => {
              void garmentQuery.refetch();
              void renderQuery.refetch();
            }}
            retryLabel={t('error.retry')}
            secondaryAction={
              <Button asChild variant="secondary">
                <Link href={routes.admin.catalog(locale)}>{t('error.back')}</Link>
              </Button>
            }
          />
        )}
      </AdminDensityScope>
    );
  }

  const garment = garmentQuery.data;
  const render = renderQuery.data;
  const models = modelsQuery.data ?? [];
  const busy = runRender.isPending || approve.isPending || reject.isPending;

  const header = (
    <AdminPageHeader
      title={t('title', { title: garment.title })}
      description={t('description')}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={routes.admin.garment(locale, garmentId)}>{t('backToGarment')}</Link>
        </Button>
      }
      meta={
        <>
          <PublishStatePill state={garment.publishState} />
          <TestRenderStatePill state={render.testRenderState} />
        </>
      }
    />
  );

  const runControls = (
    <AdminSection title={t('run.title')} description={t('run.description')}>
      <FormField>
        <FormLabel>{t('run.model')}</FormLabel>
        <Select value={modelId} onValueChange={setModelId}>
          {/* `FormControl` wires the trigger; the Radix root renders no DOM node. */}
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder={t('run.modelDefault')} />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectItem value={DEFAULT_MODEL}>{t('run.modelDefault')}</SelectItem>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormHint>{t('run.modelHint')}</FormHint>
      </FormField>

      <Callout tone="info" title={t('run.costTitle')}>
        {t('run.costBody')}
      </Callout>

      <div>
        <Button
          loading={runRender.isPending}
          loadingLabel={t('run.action')}
          onClick={() => void handleRun()}
        >
          {render.renderUrl === null ? t('run.action') : t('run.again')}
        </Button>
      </div>
    </AdminSection>
  );

  // Nothing has been rendered yet — the empty state is the run control, not a report of absence.
  if (render.renderUrl === null && render.sourceUrl === null) {
    return (
      <AdminDensityScope>
        {header}
        <EmptyState
          title={t('noSource.title')}
          description={t('noSource.body')}
          action={
            <Button asChild>
              <Link href={routes.admin.garment(locale, garmentId)}>{t('noSource.action')}</Link>
            </Button>
          }
        />
      </AdminDensityScope>
    );
  }

  return (
    <AdminDensityScope>
      {header}

      {render.errorCode !== null ? (
        <Callout tone="danger" title={t('failedTitle')}>
          {errorCopy.fromCode(render.errorCode)}
        </Callout>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSection title={t('sourceTitle')} description={t('sourceDescription')}>
          <Zoomable label={t('zoomSource')}>
            <SignedImage
              src={render.sourceUrl}
              alt={t('sourceAlt', { title: garment.title })}
              ratio="garment"
              rounded="md"
              sizes="(min-width: 1024px) 40vw, 90vw"
              fallbackLabel={t('imageUnavailable')}
              emptyLabel={t('noImage')}
            />
          </Zoomable>
        </AdminSection>

        <AdminSection title={t('renderTitle')} description={t('renderDescription')}>
          {render.renderUrl === null ? (
            <p className="rounded-md border border-dashed border-line-strong p-4 text-sm text-ink-muted">
              {t('notRunYet')}
            </p>
          ) : (
            <Zoomable label={t('zoomRender')}>
              <SignedImage
                src={render.renderUrl}
                alt={t('renderAlt', { title: garment.title })}
                ratio="render"
                rounded="md"
                sizes="(min-width: 1024px) 40vw, 90vw"
                fallbackLabel={t('imageUnavailable')}
                emptyLabel={t('noImage')}
              />
            </Zoomable>
          )}
        </AdminSection>
      </div>

      {render.renderUrl !== null ? (
        <AdminSection title={t('decision.title')} description={t('decision.description')}>
          {render.testRenderState === 'APPROVED' ? (
            <Callout tone="success" title={t('decision.approvedTitle')}>
              {t('decision.approvedBody')}
            </Callout>
          ) : null}

          {render.testRenderState === 'REJECTED' ? (
            <Callout tone="warning" title={t('decision.rejectedTitle')}>
              {t('decision.rejectedBody')}
            </Callout>
          ) : null}

          {rejecting ? (
            <FormField required>
              <FormLabel>{t('decision.reasonLabel')}</FormLabel>
              <FormControl>
                <Textarea
                  value={reason}
                  rows={3}
                  maxLength={MAX_REJECT_REASON_LENGTH}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={t('decision.reasonPlaceholder')}
                />
              </FormControl>
              <FormHint>{t('decision.reasonHint')}</FormHint>
              <FormError>
                {reasonTouched && reason.trim() === '' ? t('decision.reasonRequired') : undefined}
              </FormError>
            </FormField>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {render.testRenderState !== 'APPROVED' ? (
              <Button
                variant="primary"
                disabled={busy}
                loading={approve.isPending}
                loadingLabel={t('decision.approve')}
                onClick={() => void handleApprove()}
              >
                {t('decision.approve')}
              </Button>
            ) : null}

            {rejecting ? (
              <>
                <Button
                  variant="danger"
                  disabled={busy}
                  loading={reject.isPending}
                  loadingLabel={t('decision.rejectConfirm')}
                  onClick={() => void handleReject()}
                >
                  {t('decision.rejectConfirm')}
                </Button>
                <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>
                  {t('decision.cancelReject')}
                </Button>
              </>
            ) : (
              <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
                {t('decision.reject')}
              </Button>
            )}
          </div>
        </AdminSection>
      ) : null}

      {runControls}
    </AdminDensityScope>
  );
}
