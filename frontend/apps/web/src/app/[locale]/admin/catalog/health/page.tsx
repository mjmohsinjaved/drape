import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CatalogHealthScreen } from '@/features/catalog/components/CatalogHealthScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

/**
 * The console is per-request, never prerendered.
 *
 * `lib/server-api.ts` catches every throw from its axios call, including the dynamic-usage
 * signal Next raises when `cookies()` is read during a static render — so a page that reads
 * through it would prerender to a data-less shell instead of bailing to dynamic. Saying so
 * explicitly keeps every admin screen request-scoped and its session-scoped reads honest.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin.catalog.health' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.admin.catalogHealth(locale),
  });
}

/**
 * A-15 — catalog health.
 *
 * Nothing is fetched here. The panel is composed from several `GET /admin/garments` sweeps
 * (see `useCatalogHealth` — there is no `GET /admin/catalog-health` route in `apps/api` despite
 * ARCHITECTURE §5.6 listing one), and doing that work server-side would double it: the island
 * needs the same data in its own cache to keep the four groups in step as an admin fixes rows.
 */
export default async function AdminCatalogHealthPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <CatalogHealthScreen locale={locale} />;
}
