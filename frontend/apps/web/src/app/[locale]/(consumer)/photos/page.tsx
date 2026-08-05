import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PhotosScreen } from '@/features/photos/components/PhotosScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'photos' });

  return buildMetadata({
    locale,
    title: t('meta.listTitle'),
    description: t('meta.listDescription'),
    path: routes.photos(locale),
  });
}

/** Her saved photos, one of them active — C-16. */
export default async function ConsumerPhotosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <PhotosScreen locale={locale} />;
}
