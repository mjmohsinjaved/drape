import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { Button, EmptyState } from '@repo/ui';

import { DeniedState, ScreenError, SignedOutState } from '@/components/states';
import { listResultsServer } from '@/features/renders/api/server';
import { RenderCard } from '@/features/renders/components/RenderCard';
import {
  HISTORY_PAGE_SIZE,
  applyClientFilters,
  buildVerdictMap,
  hasHistoryFilter,
  toHistorySearchParams,
type  HistoryFilters as Filters } from '@/features/renders/lib/filters';
import { getShortlistServer } from '@/features/shortlist/api/server';
import { TryOnTray } from '@/features/tryon/components/TryOnTray';
import {
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
} from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { ResultListItem, Verdict } from '@/features/renders/api/types';
import type { Locale } from '@/i18n/config';

export interface HistoryScreenProps {
  locale: Locale;
  filters: Filters;
}

export async function HistoryScreen({ locale, filters }: HistoryScreenProps) {
  const t = await getTranslations({ locale, namespace: 'renders' });

  const query = {
    page: filters.page,
    limit: HISTORY_PAGE_SIZE,
    search: filters.search,
    personPhotoId: filters.photoId,
  };

  const [results, shortlist] = await Promise.all([
    listResultsServer(query),
    getShortlistServer(),
  ]);

  if (!results.ok) {
    if (isAuthenticationRequired(results.error.errorCode)) {
      return <SignedOutState />;
    }

    if (isPermissionDenied(results.error.errorCode)) return <DeniedState locale={locale} />;

    const key = `errors.${results.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.title')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={results.error.requestId}
        retryable={isRetryableCode(results.error.errorCode)}
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href={routes.browse(locale)}>{t('empty.action')}</Link>
          </Button>
        }
      />
    );
  }

  const verdicts = buildVerdictMap(shortlist.ok ? shortlist.data.items : []);
  const visible = applyClientFilters(results.data, filters, verdicts);
  const totalPages = results.meta?.totalPages ?? 1;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-balance md:text-4xl">{t('list.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('list.subtitle')}</p>
      </header>

      {results.data.length === 0 ? (
        <EmptyHistory locale={locale} filters={filters} />
      ) : visible.length === 0 ? (
        <EmptyHistory locale={locale} filters={filters} filteredOut />
      ) : (
        <RenderList locale={locale} results={visible} verdicts={verdicts} />
      )}

      {totalPages > 1 ? (
        <HistoryPagination locale={locale} filters={filters} totalPages={totalPages} />
      ) : null}

      <TryOnTray locale={locale} />
    </div>
  );
}

function RenderList({
  locale,
  results,
  verdicts,
}: {
  locale: Locale;
  results: ResultListItem[];
  verdicts: Map<string, Verdict>;
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 xl:grid-cols-4">
      {results.map((result) => (
        <li key={result.id}>
          <RenderCard
            locale={locale}
            result={result}
            verdict={result.garmentId === null ? undefined : verdicts.get(result.garmentId)}
          />
        </li>
      ))}
    </ul>
  );
}

async function EmptyHistory({
  locale,
  filters,
  filteredOut = false,
}: {
  locale: Locale;
  filters: Filters;
  filteredOut?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'renders.empty' });

  if (filters.search !== undefined) {
    return (
      <EmptyState
        title={t('searchTitle')}
        description={t('searchDescription', { term: filters.search })}
        action={
          <Button asChild variant="secondary">
            <Link href={routes.renders(locale)}>{t('searchAction')}</Link>
          </Button>
        }
      />
    );
  }

  if (filteredOut || hasHistoryFilter(filters)) {
    return (
      <EmptyState
        title={t('filteredTitle')}
        description={t('filteredDescription')}
        action={
          <Button asChild variant="secondary">
            <Link href={routes.renders(locale)}>{t('filteredAction')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      title={t('title')}
      description={t('description')}
      action={
        <Button asChild variant="primary" size="lg">
          <Link href={routes.browse(locale)}>{t('action')}</Link>
        </Button>
      }
    />
  );
}

async function HistoryPagination({
  locale,
  filters,
  totalPages,
}: {
  locale: Locale;
  filters: Filters;
  totalPages: number;
}) {
  const t = await getTranslations({ locale, namespace: 'browse.pagination' });

  const href = (page: number): string => {
    const query = toHistorySearchParams({ ...filters, page }).toString();
    const base = routes.renders(locale);
    return query === '' ? base : `${base}?${query}`;
  };

  const linkClass =
    'inline-flex min-h-11 items-center rounded-md border border-line-strong px-4 text-sm hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]';

  return (
    <nav aria-label={t('label')} className="flex items-center justify-between gap-4">
      {filters.page > 1 ? (
        <Link href={href(filters.page - 1)} className={linkClass} rel="prev">
          {t('previous')}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-ink-muted">
        {t('page', { page: filters.page, total: totalPages })}
      </p>
      {filters.page < totalPages ? (
        <Link href={href(filters.page + 1)} className={linkClass} rel="next">
          {t('next')}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
