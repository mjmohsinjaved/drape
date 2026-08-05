'use client';

import Link from 'next/link';

import { CameraOff, Clock, ImageOff, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  ErrorState,
  PermissionDeniedState,
  Skeleton,
  Stat,
  SuccessState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VisuallyHidden,
} from '@repo/ui';
import { formatRelative } from '@repo/utils';

import { SignedOutState } from '@/components/states';
import {
  AdminPage,
  AdminPageHeader,
  AdminSection,
} from '@/features/catalog/components/AdminPage';
import {
  PublishStatePill,
  QualityPill,
  TestRenderStatePill,
} from '@/features/catalog/components/CatalogPills';
import {
  isPermissionDenied,
  isSignedOut,
  useCatalogErrorCopy,
} from '@/features/catalog/hooks/use-catalog-error';
import { useCatalogHealth } from '@/features/catalog/hooks/use-catalog-health';
import {
  DEFAULT_QUALITY_MIN_SCORE,
  ELEVATED_FAILURE_COUNT,
  STALE_TRY_ON_DAYS,
  type AdminGarment,
  type CatalogHealthGroup,
} from '@/features/catalog/types/admin-catalog';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface CatalogHealthScreenProps {
  locale: Locale;
}

/**
 * A-15 — "garments missing an approved test render, low quality scores, elevated failure rates,
 * zero try-ons in 30 days."
 *
 * Four groups, each a dense table whose every row links to the screen that fixes it. A health
 * panel that only counts problems is a slower version of the catalog list; the value is that
 * each row is one click from its remedy.
 *
 * The panel is composed from the catalog list endpoint — see `useCatalogHealth` for why — and it
 * says so when the sweep hit its ceiling rather than presenting a partial count as a total.
 */
export function CatalogHealthScreen({ locale }: CatalogHealthScreenProps) {
  const t = useTranslations('admin.catalog.health');
  const errorCopy = useCatalogErrorCopy();
  const query = useCatalogHealth();

  if (query.isPending) {
    return (
      <AdminPage>
        <AdminPageHeader title={t('title')} description={t('description')} />
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-4">
          <VisuallyHidden>{t('loading')}</VisuallyHidden>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-md" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-md" />
        </div>
      </AdminPage>
    );
  }

  if (query.isError) {
    return (
      <AdminPage>
        <AdminPageHeader title={t('title')} description={t('description')} />
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
          />
        )}
      </AdminPage>
    );
  }

  const health = query.data;
  const totalProblems =
    health.missingTestRender.total +
    health.lowQualityScore.total +
    health.elevatedFailureRate.total +
    health.zeroTryOnsIn30Days.total;

  return (
    <AdminPage>
      <AdminPageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={routes.admin.catalog(locale)}>{t('backToCatalog')}</Link>
          </Button>
        }
        meta={<span>{t('inspected', { count: health.inspected })}</span>}
      />

      {health.truncated ? (
        <Callout tone="info" title={t('truncatedTitle')}>
          {t('truncatedBody', { count: health.inspected })}
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t('groups.missingTestRender.title')}
          value={health.missingTestRender.total}
          hint={t('groups.missingTestRender.hint')}
          icon={<ImageOff aria-hidden="true" />}
        />
        <Stat
          label={t('groups.lowQualityScore.title')}
          value={health.lowQualityScore.total}
          hint={t('groups.lowQualityScore.hint', { minScore: DEFAULT_QUALITY_MIN_SCORE })}
          icon={<CameraOff aria-hidden="true" />}
        />
        <Stat
          label={t('groups.elevatedFailureRate.title')}
          value={health.elevatedFailureRate.total}
          hint={t('groups.elevatedFailureRate.hint', { count: ELEVATED_FAILURE_COUNT })}
          icon={<TriangleAlert aria-hidden="true" />}
        />
        <Stat
          label={t('groups.zeroTryOnsIn30Days.title')}
          value={health.zeroTryOnsIn30Days.total}
          hint={t('groups.zeroTryOnsIn30Days.hint', { days: STALE_TRY_ON_DAYS })}
          icon={<Clock aria-hidden="true" />}
        />
      </div>

      {/*
        The D-5 success state, not an empty one: a health panel with nothing in it is the
        outcome an admin is working towards, so it is confirmed rather than reported as absence.
      */}
      {totalProblems === 0 ? (
        <SuccessState
          title={t('allClear.title')}
          description={t('allClear.body')}
          action={
            <Button asChild variant="secondary">
              <Link href={routes.admin.catalog(locale)}>{t('allClear.action')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <HealthGroup
            locale={locale}
            title={t('groups.missingTestRender.title')}
            description={t('groups.missingTestRender.description')}
            group={health.missingTestRender}
            emptyLabel={t('groups.empty')}
            fixLabelKey="testRender"
          />
          <HealthGroup
            locale={locale}
            title={t('groups.lowQualityScore.title')}
            description={t('groups.lowQualityScore.description', {
              minScore: DEFAULT_QUALITY_MIN_SCORE,
            })}
            group={health.lowQualityScore}
            emptyLabel={t('groups.empty')}
            fixLabelKey="photo"
          />
          <HealthGroup
            locale={locale}
            title={t('groups.elevatedFailureRate.title')}
            description={t('groups.elevatedFailureRate.description')}
            group={health.elevatedFailureRate}
            emptyLabel={t('groups.empty')}
            fixLabelKey="photo"
          />
          <HealthGroup
            locale={locale}
            title={t('groups.zeroTryOnsIn30Days.title')}
            description={t('groups.zeroTryOnsIn30Days.description', { days: STALE_TRY_ON_DAYS })}
            group={health.zeroTryOnsIn30Days}
            emptyLabel={t('groups.empty')}
            fixLabelKey="review"
          />
        </>
      )}
    </AdminPage>
  );
}

interface HealthGroupProps {
  locale: Locale;
  title: string;
  description: string;
  group: CatalogHealthGroup;
  emptyLabel: string;
  fixLabelKey: 'testRender' | 'photo' | 'review';
}

/** One problem, one table, every row a link to the screen that fixes it. */
function HealthGroup({
  locale,
  title,
  description,
  group,
  emptyLabel,
  fixLabelKey,
}: HealthGroupProps) {
  const t = useTranslations('admin.catalog.health');

  if (group.total === 0) {
    return (
      <AdminSection title={title} description={description}>
        <p className="text-sm text-ink-muted">{emptyLabel}</p>
      </AdminSection>
    );
  }

  const fixHref = (garment: AdminGarment): string =>
    fixLabelKey === 'testRender'
      ? routes.admin.garmentTestRender(locale, garment.id)
      : routes.admin.garment(locale, garment.id);

  return (
    <AdminSection title={title} description={description}>
      <Table caption={title}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.piece')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('columns.category')}</TableHead>
            <TableHead>{t('columns.state')}</TableHead>
            <TableHead className="hidden sm:table-cell">{t('columns.testRender')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('columns.quality')}</TableHead>
            <TableHead numeric className="hidden lg:table-cell">
              {t('columns.failures')}
            </TableHead>
            <TableHead className="hidden xl:table-cell">{t('columns.lastTried')}</TableHead>
            <TableHead>
              <VisuallyHidden>{t('columns.fix')}</VisuallyHidden>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.items.map((garment) => (
            <TableRow key={garment.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium text-ink">{garment.title}</span>
                  <code className="text-2xs text-ink-subtle">{garment.sku}</code>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {garment.categoryName ?? t('uncategorised')}
              </TableCell>
              <TableCell>
                <PublishStatePill state={garment.publishState} />
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <TestRenderStatePill state={garment.testRenderState} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <QualityPill
                  score={garment.qualityScore}
                  minScore={DEFAULT_QUALITY_MIN_SCORE}
                  overridden={garment.qualityOverridden}
                />
              </TableCell>
              <TableCell numeric className="hidden lg:table-cell">
                {garment.failureCount}
              </TableCell>
              <TableCell className="hidden xl:table-cell">
                {garment.lastTriedAt === null ? t('never') : formatRelative(garment.lastTriedAt)}
              </TableCell>
              <TableCell>
                <Button asChild variant="ghost" size="sm">
                  <Link href={fixHref(garment)}>{t(`fix.${fixLabelKey}`)}</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminSection>
  );
}
