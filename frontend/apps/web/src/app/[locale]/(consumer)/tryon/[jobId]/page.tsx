import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PagePlaceholder } from '@/components/states';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParamsWith } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParamsWith<{ jobId: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, jobId } = await params;
  const t = await getTranslations({ locale, namespace: 'tryon.job' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.tryOnJob(locale, jobId),
  });
}

/**
 * TODO(W2): replace `PagePlaceholder` with the feature component. The route, the
 * metadata, the loading skeleton and the error boundary are already in place — this segment
 * needs a body, not a decision about where it lives (ARCHITECTURE §6.6).
 */
export default async function ConsumerTryonJobIdPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'tryon.job' });

  return (
    <PagePlaceholder
      title={t('title')}
      description={t('description')}
      workstream="W2"
      notes={[t('next1'), t('next2')]}
    />
  );
}
