import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ConsentScreen } from '@/features/consent/components/ConsentScreen';
import { RETURN_TO_PARAM } from '@/lib/constants';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams, SearchParamsProp } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams & SearchParamsProp;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'consent' });

  return buildMetadata({
    locale,
    title: t('meta.title'),
    description: t('meta.description'),
    path: routes.consent(locale),
  });
}

/**
 * The consent gate — C-11, C-12, §10.3.
 *
 * `?from=` carries where she was heading when the gate interrupted her, so agreeing returns her
 * to the piece she was looking at rather than dropping her at a generic screen. The value is
 * validated as a same-site path before use — an open redirect through a consent screen would be
 * a particularly poor place to have one.
 */
export default async function ConsumerConsentPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const raw = (await searchParams)[RETURN_TO_PARAM];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const returnTo =
    typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//')
      ? candidate
      : undefined;

  return <ConsentScreen locale={locale} returnTo={returnTo} />;
}
