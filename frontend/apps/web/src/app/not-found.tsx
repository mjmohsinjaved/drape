import { Button, EmptyState } from '@repo/ui';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { toLocale } from '@/i18n/config';
import { routes } from '@/lib/routes';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * The root 404.
 *
 * It says what happened and offers the way on (D-7), and it never distinguishes "does not
 * exist" from "not yours" — an object that belongs to someone else is masked as a 404 by the
 * API (§9.2), and this screen is what that mask looks like.
 */
export default async function NotFound() {
  const locale = toLocale(await getLocale());
  const t = await getTranslations({ locale, namespace: 'errors.notFound' });

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
