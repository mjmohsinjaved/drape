import { notFound } from 'next/navigation';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { findCategoryBySlug } from '@/features/catalog-browse/api/endpoints';
import { BrowseScreen } from '@/features/catalog-browse/components/BrowseScreen';
import { categoryName } from '@/features/catalog-browse/lib/category-name';
import { parseBrowseFilters } from '@/features/catalog-browse/lib/filters';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParamsWith, SearchParamsProp } from '@/lib/route-params';
import type { Metadata } from 'next';

/**
 * Rendered per request, never prerendered — deliberate, not a workaround.
 *
 * The public catalog is the one part of this app that could plausibly be prerendered: it is
 * reachable signed out (C-1) and it is the surface a search engine sees. It still must not be.
 * Garments, facets and categories change without a deploy and V1 has no revalidation contract,
 * so a build-time snapshot would serve yesterday's collection until the next release — and it
 * would be taken against an API that need not even be reachable during the build.
 *
 * Stating it here also keeps a later `generateStaticParams` over the slug from quietly turning
 * these into static pages. It is not standing in for a dynamic bailout: `lib/server-api.ts`
 * rethrows Next's dynamic-usage signal, so every cookie-forwarding read bails on its own.
 */
export const dynamic = 'force-dynamic';

type PageParams = LocaleParamsWith<{ categorySlug: string }>;
type Props = PageParams & SearchParamsProp;

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { locale, categorySlug } = await params;
  const t = await getTranslations({ locale, namespace: 'browse' });
  const category = await findCategoryBySlug(categorySlug);

  return buildMetadata({
    locale,
    // The same locale rule as the heading — otherwise an Urdu reader gets an
    // Urdu page under an English browser tab and an English share preview.
    title: category === null ? t('meta.browseTitle') : categoryName(category, locale),
    description: t('meta.categoryDescription'),
    path: routes.browseCategory(locale, categorySlug),
  });
}

/**
 * A category-scoped grid — C-17.
 *
 * The category is the address here, not a removable chip: `lockedCategoryId` keeps it out of the
 * filter island so she cannot clear the thing she navigated into. Everything else — colour,
 * size, weight, price, sort, search — behaves exactly as it does on `/browse`.
 *
 * A slug that names nothing is a 404 rather than the unfiltered grid, so a stale link fails
 * honestly instead of quietly showing the whole catalog.
 */
export default async function PublicBrowseCategorySlugPage({ params, searchParams }: Props) {
  const { locale, categorySlug } = await params;
  setRequestLocale(locale);

  const [category, filters] = await Promise.all([
    findCategoryBySlug(categorySlug),
    searchParams.then(parseBrowseFilters),
  ]);

  if (category === null) notFound();

  return (
    <BrowseScreen
      locale={locale}
      filters={filters}
      basePath={routes.browseCategory(locale, categorySlug)}
      lockedCategoryId={category.id}
      title={categoryName(category, locale)}
    />
  );
}
