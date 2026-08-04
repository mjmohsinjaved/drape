import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PagePlaceholder } from '@/components/states';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParamsWith } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParamsWith<{ enquiryId: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, enquiryId } = await params;
  const t = await getTranslations({ locale, namespace: 'admin.enquiry' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.admin.enquiry(locale, enquiryId),
  });
}

/**
 * TODO(W4): replace `PagePlaceholder` with the feature component. The route, the
 * metadata, the loading skeleton and the error boundary are already in place — this segment
 * needs a body, not a decision about where it lives (ARCHITECTURE §6.6).
 */
export default async function AdminEnquiriesEnquiryIdPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin.enquiry' });

  return (
    <PagePlaceholder
      title={t('title')}
      description={t('description')}
      workstream="W4"
      notes={[t('next1'), t('next2')]}
    />
  );
}
