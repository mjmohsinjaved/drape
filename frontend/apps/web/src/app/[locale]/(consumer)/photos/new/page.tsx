import { redirect } from 'next/navigation';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getMyConsentServer } from '@/features/consent/api/server';
import { AddPhotoScreen } from '@/features/photos/components/AddPhotoScreen';
import { RETURN_TO_PARAM } from '@/lib/constants';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams, SearchParamsProp } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams & SearchParamsProp;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'photos' });

  return buildMetadata({
    locale,
    title: t('meta.newTitle'),
    description: t('meta.newDescription'),
    path: routes.photoNew(locale),
  });
}

/**
 * Add a photo — C-13, C-14, C-15, behind the C-11 gate.
 *
 * **The gate is hard.** Consent is checked here, server-side, before the picker is rendered at
 * all: a consumer who has not agreed — or who agreed to a superseded version (C-12) — is sent to
 * `/consent` carrying her way back. The API refuses the finalise call for the same reason
 * (`CONSENT_REQUIRED` / `CONSENT_STALE`), so this redirect is a courtesy on top of the
 * enforcement, never instead of it (B-2, S-3).
 */
export default async function ConsumerPhotosNewPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const raw = (await searchParams)[RETURN_TO_PARAM];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const returnTo =
    typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//')
      ? candidate
      : undefined;

  const consent = await getMyConsentServer();
  if (consent.ok && consent.data.status !== 'GRANTED') {
    const back = returnTo ?? routes.photoNew(locale);
    redirect(`${routes.consent(locale)}?${RETURN_TO_PARAM}=${encodeURIComponent(back)}`);
  }

  return <AddPhotoScreen locale={locale} returnTo={returnTo} />;
}
