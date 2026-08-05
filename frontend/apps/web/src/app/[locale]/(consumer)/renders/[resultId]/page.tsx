import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RenderDetailScreen } from '@/features/renders/components/RenderDetailScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

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

type Props = LocaleParamsWith<{ resultId: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, resultId } = await params;
  const t = await getTranslations({ locale, namespace: 'renders' });

  return buildMetadata({
    locale,
    title: t('meta.detailTitle'),
    description: t('meta.detailDescription'),
    path: routes.render(locale, resultId),
    // Never indexed and never given a social card: this is her own image (§9.3).
    noIndex: true,
  });
}

/** One render: compare, zoom, the caption and the verdict controls (C-20, C-26). */
export default async function ConsumerRendersResultIdPage({ params }: Props) {
  const { locale, resultId } = await params;
  setRequestLocale(locale);

  return <RenderDetailScreen locale={locale} resultId={resultId} />;
}
