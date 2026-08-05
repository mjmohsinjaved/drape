import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BrowseScreen } from '@/features/catalog-browse/components/BrowseScreen';
import { parseBrowseFilters } from '@/features/catalog-browse/lib/filters';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams, SearchParamsProp } from '@/lib/route-params';
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
