import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { Button, EmptyState, ShortlistingCaption } from '@repo/ui';

import { DeniedState, PartialDataNotice, ScreenError, SignedOutState } from '@/components/states';
import { DeleteMyDataLink } from '@/features/consent/components/DeleteMyDataLink';
import { listPhotosServer } from '@/features/photos/api/server';
import {
  listResultGroupsServer,
  listResultsServer,
} from '@/features/renders/api/server';
import { HistoryFilters } from '@/features/renders/components/HistoryFilters';
import { RenderCard } from '@/features/renders/components/RenderCard';
import {
  HISTORY_PAGE_SIZE,
  applyClientFilters,
  buildVerdictMap,
  categoryOptions,
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

/**
 * Try-on history — PRD C-24 … C-31.
 *
 * > "Every successful generation is stored permanently against her account and appears in History
 * > automatically. She takes no action to save a result."
 *
 * Which is why there is no "save" anywhere on this screen and no empty-state instruction to
 * start saving. The empty state points at the collection, because the way to fill history is to
 * try something on.
 *
 * Four reads, in parallel: the results themselves, the same set grouped by photo (C-30), her
 * photos (so the grouping control only appears when it means something), and her shortlist —
 * which is the only place a verdict lives (§4.20).
 */
export async function HistoryScreen({ locale, filters }: HistoryScreenProps) {
  const t = await getTranslations({ locale, namespace: 'renders' });

  const query = {
    page: filters.page,
    limit: HISTORY_PAGE_SIZE,
    search: filters.search,
    personPhotoId: filters.photoId,
  };

  const [results, groups, photos, shortlist] = await Promise.all([
    listResultsServer(query),
    filters.groupByPhoto
      ? listResultGroupsServer(query)
      : Promise.resolve({ ok: true as const, data: [] }),
    listPhotosServer(),
    getShortlistServer(),
  ]);

  if (!results.ok) {
    // D-5: a session that ended under an open screen is not an authorisation refusal. Signing
    // in is what fixes it, and the return path brings her back to this exact screen.
    if (isAuthenticationRequired(results.error.errorCode)) {
      return <SignedOutState />;
    }

    // S-9 / D-5: an authorisation refusal is the permission-denied state, never an error
    // state and never a raw 403.
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

  // Two of the four reads are secondary — her try-ons render without either. But both feed
  // *filters*, and a filter built from a failed read quietly narrows the list: an empty verdict
  // map makes every try-on look undecided, and an empty photo list removes grouping altogether.
  // Neither may pass for the truth, so each one that failed is named.
  const incomplete: string[] = [];
  if (!photos.ok) incomplete.push(t('list.partial.photos'));
  if (!shortlist.ok) incomplete.push(t('list.partial.verdicts'));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-balance md:text-4xl">{t('list.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('list.subtitle')}</p>
      </header>

      {incomplete.length === 0 ? null : (
        <PartialDataNotice title={t('list.partial.title')} items={incomplete} />
      )}

      <HistoryFilters
        filters={filters}
        categories={categoryOptions(results.data)}
        photos={photos.ok ? photos.data : []}
        resultCount={visible.length}
      />

      {results.data.length === 0 ? (
        <EmptyHistory locale={locale} filters={filters} />
      ) : visible.length === 0 ? (
        <EmptyHistory locale={locale} filters={filters} filteredOut />
      ) : filters.groupByPhoto && groups.ok && groups.data.length > 0 ? (
        <div className="flex flex-col gap-10">
          {groups.data.map((group) => {
            const items = applyClientFilters(group.items, filters, verdicts);
            if (items.length === 0) return null;

            return (
              <section
                key={group.personPhotoId ?? 'deleted-photo'}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-medium">
                    {group.personPhotoLabel === null
                      ? t('list.group.headingUnnamed')
                      : t('list.group.heading', { label: group.personPhotoLabel })}
                  </h2>
                  <p className="text-sm text-ink-muted">
                    {t('list.group.count', { count: group.count })}
                  </p>
                </div>
                <RenderList locale={locale} results={items} verdicts={verdicts} />
              </section>
            );
          })}
        </div>
      ) : (
        <RenderList locale={locale} results={visible} verdicts={verdicts} />
      )}

      {totalPages > 1 ? (
        <HistoryPagination locale={locale} filters={filters} totalPages={totalPages} />
      ) : null}

      <ShortlistingCaption>{t('caption')}</ShortlistingCaption>

      <DeleteMyDataLink locale={locale} />

      {/* C-19: a try-on started elsewhere finishes and reports itself here too. */}
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
    <ul className="flex flex-col gap-6">
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

/**
 * Two empty states (D-6). A filtered-out list offers the filters back; a genuinely empty history
 * points at the collection, because trying something on is the only way to fill it.
 */
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
