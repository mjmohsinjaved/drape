import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PagePlaceholder } from '@/components/states';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { Metadata } from 'next';
import type { LocaleParamsWith } from '@/lib/route-params';

type Props = LocaleParamsWith<{ slug: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'catalog.garment' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.garment(locale, slug),
  });
}

/**
 * TODO(W2): replace `PagePlaceholder` with the feature component. The route, the
 * metadata, the loading skeleton and the error boundary are already in place — this segment
 * needs a body, not a decision about where it lives (ARCHITECTURE §6.6).
 */
export default async function PublicGarmentsSlugPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'catalog.garment' });

  return (
    <PagePlaceholder
      title={t('title')}
      description={t('description')}
      workstream="W2"
      notes={[t('next1'), t('next2')]}
    />
  );
}
