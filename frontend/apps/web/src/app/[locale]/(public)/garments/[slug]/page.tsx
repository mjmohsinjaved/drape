import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getCatalogGarment } from '@/features/catalog-browse/api/endpoints';
import { GarmentDetailScreen } from '@/features/catalog-browse/components/GarmentDetailScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { isAuthenticated } from '@/lib/session';

import type { LocaleParamsWith } from '@/lib/route-params';
import type { Metadata } from 'next';

/**
 * Rendered per request, never prerendered — deliberate, not a workaround.
 *
 * The public catalog is the one part of this app that could plausibly be prerendered: it is
 * reachable signed out (C-1) and it is the surface a search engine sees. It still must not be.
 * Garments, facets and categories change without a deploy and V1 has no revalidation contract,
 * so a build-time snapshot would serve yesterday's collection until the next release — and it
 * would be taken against an API that need not even be reachable during the build.
 *
 * Stating it here also keeps a later `generateStaticParams` over the slug from quietly turning
 * these into static pages. It is not standing in for a dynamic bailout: `lib/server-api.ts`
 * rethrows Next's dynamic-usage signal, so every cookie-forwarding read bails on its own.
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

  // The session read and the garment read need nothing from each other, so they overlap rather
  // than queue: this route is on the §9.1 budget, and an awaited `/auth/me` in front of the
  // garment fetch adds a full round trip before the first byte.
  //
  // `getCatalogGarment` is memoised per request, so the screen below re-reads the same promise
  // instead of issuing a second call — this warms it, it does not duplicate it.
  const [signedIn] = await Promise.all([isAuthenticated(), getCatalogGarment(slug)]);

  return <GarmentDetailScreen locale={locale} slug={slug} isAuthenticated={signedIn} />;
}
