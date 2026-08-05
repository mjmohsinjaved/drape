import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ShortlistScreen } from '@/features/shortlist/components/ShortlistScreen';
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
  const t = await getTranslations({ locale, namespace: 'shortlist' });

  return buildMetadata({
    locale,
    title: t('meta.title'),
    description: t('meta.description'),
    path: routes.shortlist(locale),
  });
}

/** Drag-to-rank, per-item notes and the running total against her budget (C-32). */
export default async function ConsumerShortlistPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ShortlistScreen locale={locale} />;
}
