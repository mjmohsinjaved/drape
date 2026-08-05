import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NewGarmentScreen } from '@/features/catalog/components/NewGarmentScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { AdminCategory } from '@/features/categories/types/admin-categories';
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
  const t = await getTranslations({ locale, namespace: 'admin.catalog.new' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.admin.catalogNew(locale),
  });
}

/**
 * A-8 — creating a garment.
 *
 * The category tree is read server-side because the form cannot be submitted without one:
 * `categoryId` is required, so an empty tree is not an error state but a different screen (D-6).
 */
export default async function AdminCatalogNewPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const categories = await serverGet<AdminCategory[]>('/admin/categories', {
    params: { includeArchived: false },
  });

  return <NewGarmentScreen locale={locale} categories={categories.ok ? categories.data : []} />;
}
