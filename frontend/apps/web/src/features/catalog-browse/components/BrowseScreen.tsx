import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { Button, EmptyState } from '@repo/ui';

import { PartialDataNotice, ScreenError } from '@/components/states';
import {
  getCatalogFacets,
  getCatalogGarments,
} from '@/features/catalog-browse/api/endpoints';
import { BrowseFilters } from '@/features/catalog-browse/components/BrowseFilters';
import { BrowsePagination } from '@/features/catalog-browse/components/BrowsePagination';
import { GarmentCard } from '@/features/catalog-browse/components/GarmentCard';
import { hasAnyFilter, toCatalogQuery ,type  BrowseFilters as Filters } from '@/features/catalog-browse/lib/filters';
import { TryOnTray } from '@/features/tryon/components/TryOnTray';
import { isRetryableCode } from '@/features/tryon/lib/error-copy';

import type { Locale } from '@/i18n/config';

export interface BrowseScreenProps {
  locale: Locale;
  filters: Filters;
  /** Where the filter island and the paginator write to — `/browse` or `/browse/[slug]`. */
  basePath: string;
  /** Set on a category route: the category is the address, not a removable filter. */
  lockedCategoryId?: string;
  /** Optional page heading override — the category name on a category route. */
  title?: string;
  subtitle?: string;
}

/**
 * The catalog grid — C-1, C-17, §9.1.
 *
 * **Server-rendered.** The two reads below run on the server with the incoming cookie
 * forwarded (B-9), so the HTML that reaches a phone on 4G already contains the cards. The only
 * client JavaScript on this screen is the filter island, which writes the query string, and the
 * results tray, which is how a try-on started here can finish while she keeps browsing (C-19).
 *
 * All six D-5 states live here: default (the grid), loading (`loading.tsx`, aspect-matched),
 * empty (two shapes — filtered and genuinely empty, each pointing at the next action per D-6),
 * error (what happened and what to do next, D-7), permission-denied (browsing is public, so the
 * state that applies is the API refusing, which resolves to error copy), and success (a started
 * try-on, which the tray owns).
 */
export async function BrowseScreen({
  locale,
  filters,
  basePath,
  lockedCategoryId,
  title,
  subtitle,
}: BrowseScreenProps) {
  const t = await getTranslations({ locale, namespace: 'browse' });

  const query = toCatalogQuery(filters, { categoryId: lockedCategoryId ?? filters.categoryId });
  const [garments, facets] = await Promise.all([getCatalogGarments(query), getCatalogFacets()]);

  if (!garments.ok) {
    const key = `errors.${garments.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.title')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={garments.error.requestId}
        retryable={isRetryableCode(garments.error.errorCode)}
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href={basePath}>{t('empty.catalogAction')}</Link>
          </Button>
        }
      />
    );
  }

  const items = garments.data;
  const meta = garments.meta;
  const totalPages = meta?.totalPages ?? 1;
  const resultCount = meta?.total ?? items.length;

  return (
    <div className="flex flex-col gap-8 md:gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-balance md:text-4xl">
          {title ?? t('heading.title')}
        </h1>
        <p className="max-w-prose text-ink-muted">{subtitle ?? t('heading.subtitle')}</p>
      </header>

      {/* The facet read is secondary — the grid is complete without it. What is not acceptable
          is drawing a filter list built from nothing and letting it read as the full set of
          choices, so a failed read is announced rather than absorbed. */}
      {facets.ok ? null : (
        <PartialDataNotice
          title={t('filters.partial.title')}
          items={[t('filters.partial.facets')]}
        />
      )}

      <BrowseFilters
        locale={locale}
        filters={filters}
        facets={facets.ok ? facets.data : null}
        lockedCategoryId={lockedCategoryId}
        resultCount={resultCount}
      />

      {items.length === 0 ? (
        <EmptyGrid locale={locale} filters={filters} basePath={basePath} />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 xl:grid-cols-4">
            {items.map((garment, index) => (
              <li key={garment.id}>
                {/* The first row is the LCP candidate on every viewport from 360 px up. */}
                <GarmentCard locale={locale} garment={garment} priority={index < 4} />
              </li>
            ))}
          </ul>

          <BrowsePagination
            filters={filters}
            basePath={basePath}
            page={meta?.page ?? filters.page}
            totalPages={totalPages}
          />
        </>
      )}

      <TryOnTray locale={locale} />
    </div>
  );
}

/**
 * Two empty states, because they mean different things (D-6).
 *
 * A filtered empty grid is her filters being too narrow, and the action clears them. A genuinely
 * empty catalog is the studio still photographing, and the action is to come back — neither
 * simply reports that there is nothing here.
 */
async function EmptyGrid({
  locale,
  filters,
  basePath,
}: {
  locale: Locale;
  filters: Filters;
  basePath: string;
}) {
  const t = await getTranslations({ locale, namespace: 'browse' });

  if (filters.search !== undefined) {
    return (
      <EmptyState
        title={t('empty.searchTitle')}
        description={t('empty.searchDescription', { term: filters.search })}
        action={
          <Button asChild variant="primary">
            <Link href={basePath}>{t('empty.action')}</Link>
          </Button>
        }
      />
    );
  }

  if (hasAnyFilter(filters)) {
    return (
      <EmptyState
        title={t('empty.title')}
        description={t('empty.description')}
        action={
          <Button asChild variant="primary">
            <Link href={basePath}>{t('empty.action')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      title={t('empty.catalogTitle')}
      description={t('empty.catalogDescription')}
      action={
        <Button asChild variant="secondary">
          <Link href={basePath}>{t('empty.catalogAction')}</Link>
        </Button>
      }
    />
  );
}
