import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getCatalogGarment } from '@/features/catalog-browse/api/endpoints';
import { GarmentDetailScreen } from '@/features/catalog-browse/components/GarmentDetailScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { isAuthenticated } from '@/lib/session';

import type { LocaleParamsWith } from '@/lib/route-params';
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

type Props = LocaleParamsWith<{ slug: string }>;

/**
 * Metadata from the garment itself, so a shared link previews the piece rather than the app.
 * The description is deliberately about the piece and never about the try-on: nothing in a
 * social card may promise accuracy or say "see yourself in" (§9.4).
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'browse' });
  const result = await getCatalogGarment(slug);

  const garment = result.ok ? result.data : null;
  const title =
    garment === null ? t('meta.browseTitle') : locale === 'ur' && garment.titleUr ? garment.titleUr : garment.title;

  return buildMetadata({
    locale,
    title,
    description: garment?.description ?? t('meta.garmentDescription'),
    path: routes.garment(locale, slug),
    ogImage: garment?.primaryImage?.url,
  });
}

/**
 * Garment detail — C-18. Public, like the rest of browse (C-1).
 *
 * The session is read only to decide whether Try it on posts or prompts for sign-in; it gates
 * nothing here, and every authorisation decision belongs to the API (S-3, B-2).
 */
export default async function PublicGarmentsSlugPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const signedIn = await isAuthenticated();

  return <GarmentDetailScreen locale={locale} slug={slug} isAuthenticated={signedIn} />;
}
