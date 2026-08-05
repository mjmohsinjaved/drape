import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PhotosScreen } from '@/features/photos/components/PhotosScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

/**
 * Rendered per request, never prerendered at build time.
 *
 * Every read on this route goes through the cookie-forwarding server client (B-9), and the
 * catalog, her photos, her renders and her shortlist all change without a deploy. Without this
 * the segment is a build-time snapshot taken against an API that may not even be reachable — and
 * `serverGet` deliberately never throws (D-5 renders states rather than crashing), so that
 * snapshot would bake in silently rather than failing the build.
 */
export const dynamic = 'force-dynamic';

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
