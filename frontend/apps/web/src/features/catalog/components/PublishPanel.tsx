'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  DescriptionItem,
  DescriptionList,
  DirectionalIcon,
  TypeToConfirmDialog,
  toast,
} from '@repo/ui';
import { formatDateTime } from '@repo/utils';

import { AdminSection } from '@/features/catalog/components/AdminPage';
import { PublishStatePill, TestRenderStatePill } from '@/features/catalog/components/CatalogPills';
import { useCatalogErrorCopy } from '@/features/catalog/hooks/use-catalog-error';
import { useDeleteGarment, useGarmentStateChange } from '@/features/catalog/hooks/use-garments';
import {
  DEFAULT_QUALITY_MIN_SCORE,
  type AdminGarment,
} from '@/features/catalog/types/admin-catalog';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface PublishPanelProps {
  locale: Locale;
  garment: AdminGarment;
  /** From the image list — the garment cannot publish without one (A-9). */
  hasTryOnSource: boolean;
}

/** One unmet publishing recommendation, with the screen that addresses it. */
interface Advisory {
  id: string;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
}

/**
 * A-13 — the publishing recommendations, stated before the button is pressed.
 *
 * **Nothing here blocks publishing, and nothing downstream does either.** The three conditions
 * below — a try-on source (`TRYON_SOURCE_REQUIRED`), an approved test render
 * (`TEST_RENDER_REQUIRED`) and a passing quality score (`QUALITY_OVERRIDE_REQUIRED`) — are listed
 * in full, each linked to the screen that addresses it, and then the publish button is offered
 * anyway. The API agrees: it publishes regardless and writes whatever was outstanding into the
 * audit row.
 *
 * Publishing is now the whole decision. A published piece is browsable and tryable immediately,
 * whatever its test render says; the consumer catalogue and the try-on guard both stopped
 * consulting `testRenderState`.
 *
 * The one worth reading twice is the missing try-on source, because it is the condition with a
 * consequence the studio will not see: the piece is browsable and every try-on against it fails
 * at generation time.
 *
 * Deleting is permanent from the catalog's point of view, so it asks for the title to be typed
 * (D-17). The API checks the typed title too: a confirmation the API does not verify is a
 * confirmation an API client skips.
 */
export function PublishPanel({ locale, garment, hasTryOnSource }: PublishPanelProps) {
  const t = useTranslations('admin.catalog.publish');
  const errorCopy = useCatalogErrorCopy();
  const router = useRouter();

  const stateChange = useGarmentStateChange();
  const removeGarment = useDeleteGarment();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const advisories: Advisory[] = [];

  if (!hasTryOnSource) {
    advisories.push({
      id: 'source',
      title: t('blockers.source.title'),
      body: t('blockers.source.body'),
      href: routes.admin.garment(locale, garment.id),
      linkLabel: t('blockers.source.link'),
    });
  }

  if (garment.testRenderState !== 'APPROVED') {
    advisories.push({
      id: 'testRender',
      title: t('blockers.testRender.title'),
      body:
        garment.testRenderState === 'REJECTED'
          ? t('blockers.testRender.rejected')
          : garment.testRenderState === 'PENDING'
            ? t('blockers.testRender.pending')
            : t('blockers.testRender.none'),
      href: routes.admin.garmentTestRender(locale, garment.id),
      linkLabel: t('blockers.testRender.link'),
    });
  }

  const failingQuality =
    garment.qualityScore !== null && garment.qualityScore < DEFAULT_QUALITY_MIN_SCORE;

  if (failingQuality && !garment.qualityOverridden) {
    advisories.push({
      id: 'quality',
      title: t('blockers.quality.title'),
      body: t('blockers.quality.body', { score: garment.qualityScore ?? 0 }),
      href: routes.admin.garment(locale, garment.id),
      linkLabel: t('blockers.quality.link'),
    });
  }

  const runAction = async (action: 'publish' | 'unpublish' | 'archive'): Promise<void> => {
    try {
      await stateChange.mutateAsync({ garmentId: garment.id, action });
      toast.success(t(`toast.${action}`, { title: garment.title }));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
    }
  };

  const handleDelete = async (): Promise<void> => {
    try {
      await removeGarment.mutateAsync({ garmentId: garment.id, confirmTitle: garment.title });
      setDeleteOpen(false);
      toast.success(t('toast.deleted', { title: garment.title }));
      router.push(routes.admin.catalog(locale));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
    }
  };

  return (
    <AdminSection title={t('sectionTitle')} description={t('sectionDescription')}>
      <DescriptionList layout="inline" density="scale">
        <DescriptionItem term={t('fields.state')}>
          <PublishStatePill state={garment.publishState} />
        </DescriptionItem>
        <DescriptionItem term={t('fields.testRender')}>
          <TestRenderStatePill state={garment.testRenderState} />
        </DescriptionItem>
        <DescriptionItem term={t('fields.publishedAt')}>
          {garment.publishedAt === null ? t('never') : formatDateTime(garment.publishedAt)}
        </DescriptionItem>
        <DescriptionItem term={t('fields.updatedAt')}>
          {formatDateTime(garment.updatedAt)}
        </DescriptionItem>
      </DescriptionList>

      {garment.publishState !== 'PUBLISHED' && advisories.length > 0 ? (
        <Callout
          tone="warning"
          title={t('blockedTitle', { count: advisories.length })}
          icon={<AlertTriangle aria-hidden="true" className="size-4" />}
        >
          <p className="mb-3 text-sm text-ink-muted">{t('blockedBody')}</p>
          <ul className="flex flex-col gap-3">
            {advisories.map((advisory) => (
              <li key={advisory.id} className="flex flex-col gap-1">
                <span className="text-sm font-medium text-ink">{advisory.title}</span>
                <span className="text-sm text-ink-muted">{advisory.body}</span>
                <Link
                  href={advisory.href}
                  className="inline-flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline"
                >
                  {advisory.linkLabel}
                  <DirectionalIcon>
                    <ArrowRight className="size-3.5" />
                  </DirectionalIcon>
                </Link>
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {garment.publishState !== 'PUBLISHED' && advisories.length === 0 ? (
        <Callout
          tone="success"
          title={t('readyTitle')}
          icon={<CheckCircle2 aria-hidden="true" className="size-4" />}
        >
          {t('readyBody')}
        </Callout>
      ) : null}

      {garment.qualityOverridden ? (
        <Callout tone="warning" title={t('overriddenTitle')}>
          {t('overriddenBody', {
            when:
              garment.qualityOverriddenAt === null
                ? ''
                : formatDateTime(garment.qualityOverriddenAt),
          })}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {garment.publishState === 'PUBLISHED' ? (
          <Button
            variant="secondary"
            loading={stateChange.isPending}
            loadingLabel={t('actions.unpublish')}
            onClick={() => void runAction('unpublish')}
          >
            {t('actions.unpublish')}
          </Button>
        ) : (
          <Button
            variant="primary"
            // Never disabled by the advisories above. They are shown so the decision is
            // informed, not to take it away — the API publishes regardless and records
            // whatever was outstanding in the audit trail.
            disabled={false}
            loading={stateChange.isPending}
            loadingLabel={t('actions.publish')}
            onClick={() => void runAction('publish')}
          >
            {t('actions.publish')}
          </Button>
        )}

        {garment.publishState !== 'ARCHIVED' ? (
          <Button
            variant="secondary"
            loading={stateChange.isPending}
            loadingLabel={t('actions.archive')}
            onClick={() => void runAction('archive')}
          >
            {t('actions.archive')}
          </Button>
        ) : null}

        <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
          {t('actions.delete')}
        </Button>
      </div>

      <p className="text-xs text-ink-subtle">{t('archiveVsDelete')}</p>

      <TypeToConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteDialog.title', { title: garment.title })}
        description={t('deleteDialog.body')}
        confirmLabel={t('deleteDialog.confirm')}
        cancelLabel={t('deleteDialog.cancel')}
        confirmationText={garment.title}
        confirmationPrompt={t('deleteDialog.typePrompt')}
        confirmationMismatchHint={t('deleteDialog.mismatch')}
        loading={removeGarment.isPending}
        onConfirm={handleDelete}
      />
    </AdminSection>
  );
}
