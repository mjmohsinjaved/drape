import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Button, EmptyState } from '@repo/ui';

import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'errors.offline' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('body'),
    path: routes.offline(locale),
    noIndex: true,
  });
}

/**
 * The offline screen (§6.6).
 *
 * Reached when the network is gone and there is nothing cached to show. It states what
 * happened and what to do next, and offers the way back rather than a dead end (D-7, §8.2).
 */
export default async function OfflinePage({ params }: LocaleParams) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'errors.offline' });

  return (
    <div className="mx-auto flex min-h-dvh max-w-consumer items-center justify-center px-5 py-16">
      <EmptyState
        tone="neutral"
        title={t('title')}
        description={t('body')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.browse(locale)}>{t('action')}</Link>
          </Button>
        }
      />
    </div>
  );
}
