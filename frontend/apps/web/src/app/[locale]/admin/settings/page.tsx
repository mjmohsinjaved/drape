import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TryOnProviderCard } from '@/features/tryon-provider/components/TryOnProviderCard';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin.settings' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.admin.settings(locale),
  });
}

export default async function AdminSettingsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex flex-col gap-8">
      <TryOnProviderCard locale={locale} />
    </div>
  );
}
