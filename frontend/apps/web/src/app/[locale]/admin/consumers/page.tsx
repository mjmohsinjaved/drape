import { Suspense } from 'react';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PageSkeleton } from '@/components/states';
import { ConsumerListScreen } from '@/features/consumers/components/ConsumerListScreen';
import {
  listStateKey,
  parseListState,
  toServerParams,
} from '@/features/consumers/schemas/list-query';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { LocaleParams, SearchParamsProp } from '@/lib/route-params';
import type { AdminConsumerListItem } from '@repo/api-client';
import type { Metadata } from 'next';

type Props = LocaleParams & SearchParamsProp;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin.consumers' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.admin.consumers(locale),
  });
}

/**
 * A-16 — the consumer list.
 *
 * The filters live in the query string, so this Server Component fetches the exact page the
 * island is about to ask for and hands it over as `initialData`: no skeleton flash on a shared
 * or bookmarked link. The island still owns every interaction and re-requests on its own if the
 * server read failed.
 *
 * `useSearchParams` inside the island needs a Suspense boundary; the fallback is the same
 * aspect-matched table shell the segment's `loading.tsx` renders (D-8).
 */
export default async function AdminConsumersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const raw = await searchParams;
  const listState = parseListState(raw);

  const consumers = await serverGet<AdminConsumerListItem[]>('/admin/consumers', {
    params: toServerParams(listState),
  });

  const initialPage =
    consumers.ok && consumers.meta
      ? {
          items: consumers.data,
          meta: {
            page: consumers.meta.page,
            limit: consumers.meta.limit,
            total: consumers.meta.total,
            totalPages: consumers.meta.totalPages,
            sortBy: consumers.meta.sortBy ?? 'createdAt',
            sortOrder: consumers.meta.sortOrder ?? 'DESC',
          },
        }
      : undefined;

  return (
    <Suspense fallback={<PageSkeleton variant="table" />}>
      <ConsumerListScreen
        locale={locale}
        initialPage={initialPage}
        // The view these rows are for. The island uses the seed only while the two agree, so a
        // page turn reuses what has already arrived instead of re-fetching it.
        initialPageKey={listStateKey(listState)}
      />
    </Suspense>
  );
}
