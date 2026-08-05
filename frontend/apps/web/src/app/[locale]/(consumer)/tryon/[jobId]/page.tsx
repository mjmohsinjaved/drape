import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TryOnWaitScreen } from '@/features/tryon/components/TryOnWaitScreen';
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

type Props = LocaleParamsWith<{ jobId: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, jobId } = await params;
  const t = await getTranslations({ locale, namespace: 'tryon' });

  return buildMetadata({
    locale,
    title: t('meta.title'),
    description: t('meta.description'),
    path: routes.tryOnJob(locale, jobId),
  });
}

/**
 * The staged wait — C-19, §10.3.
 *
 * A thin server shell around the client screen. The wait itself has to be a Client Component:
 * it holds an SSE connection, a polling fallback and an elapsed clock, none of which a server
 * render can express. The shell exists so the segment still carries metadata and its locale.
 */
export default async function ConsumerTryonJobIdPage({ params }: Props) {
  const { locale, jobId } = await params;
  setRequestLocale(locale);

  return <TryOnWaitScreen locale={locale} jobId={jobId} />;
}
