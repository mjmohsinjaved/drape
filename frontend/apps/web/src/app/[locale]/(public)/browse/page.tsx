import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BrowseScreen } from '@/features/catalog-browse/components/BrowseScreen';
import { parseBrowseFilters } from '@/features/catalog-browse/lib/filters';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams, SearchParamsProp } from '@/lib/route-params';
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

type Props = LocaleParams & SearchParamsProp;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'browse' });

  return buildMetadata({
    locale,
    title: t('meta.browseTitle'),
    description: t('meta.browseDescription'),
    path: routes.browse(locale),
  });
}

/**
 * The catalog grid — C-1, C-17. Public: no session is required to reach it or to use it.
 *
 * The page stays short and delegates to the feature component (§6.6). Filters come from the
 * query string, which is the source of truth, so every filter change is a fresh server render
 * and a filtered view is a URL she can send to someone.
 */
export default async function PublicBrowsePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const filters = parseBrowseFilters(await searchParams);

  return <BrowseScreen locale={locale} filters={filters} basePath={routes.browse(locale)} />;
}
