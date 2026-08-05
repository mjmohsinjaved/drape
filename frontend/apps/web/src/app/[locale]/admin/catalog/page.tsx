import { Suspense } from 'react';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageSkeleton } from '@/components/states';
import { GarmentListScreen } from '@/features/catalog/components/GarmentListScreen';
import { parseListState, toServerParams } from '@/features/catalog/schemas/list-query';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { AdminGarment } from '@/features/catalog/types/admin-catalog';
import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { LocaleParams, SearchParamsProp } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams & SearchParamsProp;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin.catalog' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.admin.catalog(locale),
  });
}

/**
 * A-14 — the catalog list.
 *
 * The filters live in the query string, so this Server Component can fetch the exact page the
 * island is about to ask for and hand it over as `initialData`: no skeleton flash on a shared or
 * bookmarked link. The island still owns every interaction, and re-requests on its own if the
 * server read failed.
 *
 * `useSearchParams` inside the island needs a Suspense boundary; the skeleton is the same
 * aspect-matched table shell the segment's `loading.tsx` renders (D-8).
 */
export default async function AdminCatalogPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const raw = await searchParams;
  const listState = parseListState(raw);

  const [garments, categories] = await Promise.all([
    serverGet<AdminGarment[]>('/admin/garments', { params: toServerParams(listState) }),
    serverGet<AdminCategory[]>('/admin/categories', { params: { includeArchived: false } }),
  ]);

  const initialPage =
    garments.ok && garments.meta
      ? {
          items: garments.data,
          meta: {
            page: garments.meta.page,
            limit: garments.meta.limit,
            total: garments.meta.total,
            totalPages: garments.meta.totalPages,
            sortBy: garments.meta.sortBy ?? 'createdAt',
            sortOrder: garments.meta.sortOrder ?? 'DESC',
          },
        }
      : undefined;

  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <GarmentListScreen
        locale={locale}
        initialPage={initialPage}
        categories={categories.ok ? categories.data : []}
      />
    </Suspense>
  );
}
