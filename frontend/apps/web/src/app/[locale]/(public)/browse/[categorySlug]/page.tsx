import { notFound } from 'next/navigation';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { findCategoryBySlug } from '@/features/catalog-browse/api/endpoints';
import { BrowseScreen } from '@/features/catalog-browse/components/BrowseScreen';
import { parseBrowseFilters } from '@/features/catalog-browse/lib/filters';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParamsWith, SearchParamsProp } from '@/lib/route-params';
import type { Metadata } from 'next';

/**
 * Rendered per request, never prerendered at build time.
 *
 * Every read on this route goes through the cookie-forwarding server client (B-9), and the
 * catalog, her photos, her renders and her shortlist all change without a deploy. Without this
 * the segment is a build-time snapshot taken against an API that may not even be reachable — and
 * `serverGet` deliberately never throws (D-5 renders states rather than crashing), so that
 * snapshot would bake in silently rather than failing the build.
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
    title: category?.name ?? t('meta.browseTitle'),
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
      title={locale === 'ur' && category.nameUr ? category.nameUr : category.name}
    />
  );
}
