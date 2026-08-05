import { getTranslations, setRequestLocale } from 'next-intl/server';

import { HistoryScreen } from '@/features/renders/components/HistoryScreen';
import { parseHistoryFilters } from '@/features/renders/lib/filters';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams, SearchParamsProp } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams & SearchParamsProp;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'renders' });

  return buildMetadata({
    locale,
    title: t('meta.listTitle'),
    description: t('meta.listDescription'),
    path: routes.renders(locale),
  });
}

/** History — every render she has produced, permanent and free to revisit (C-24 … C-31). */
export default async function ConsumerRendersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const filters = parseHistoryFilters(await searchParams);

  return <HistoryScreen locale={locale} filters={filters} />;
}
