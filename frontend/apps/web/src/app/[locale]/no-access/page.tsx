import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DeniedState } from '@/components/states';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'errors.noAccess' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('body'),
    path: routes.noAccess(locale),
    noIndex: true,
  });
}

/**
 * The S-9 screen.
 *
 * A consumer who requests an admin URL lands here: plain language, a link back to the fitting
 * room, never a raw 403. Every admin URL resolves to this same screen, so it never reveals
 * whether the resource exists.
 *
 * It carries no shell. A consumer sent here from an admin URL should not be shown the admin
 * chrome even briefly, and wrapping it in the consumer shell would imply she is somewhere
 * inside her account rather than at a dead end with a way out.
 */
export default async function NoAccessPage({ params }: LocaleParams) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="mx-auto flex min-h-dvh max-w-consumer items-center justify-center px-5 py-16">
      <DeniedState locale={locale} />
    </div>
  );
}
