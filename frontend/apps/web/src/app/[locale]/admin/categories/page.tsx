import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CategoriesScreen } from '@/features/categories/components/CategoriesScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin.categories' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.admin.categories(locale),
  });
}

/**
 * A-4 … A-7 — the category manager.
 *
 * A Server Component that reads the tree with the incoming session cookie (B-9) and hands it to
 * the client island as `initialData`, so the first paint is the real tree rather than a skeleton
 * that resolves to the same thing a moment later. A failed read is not thrown: the island
 * re-requests and renders the D-5 error or permission-denied state itself, which keeps one code
 * path for "the tree did not load" whether that happened on the server or in the browser.
 */
export default async function AdminCategoriesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const result = await serverGet<AdminCategory[]>('/admin/categories', {
    params: { includeArchived: true },
  });

  return <CategoriesScreen initialTree={result.ok ? result.data : undefined} />;
}
