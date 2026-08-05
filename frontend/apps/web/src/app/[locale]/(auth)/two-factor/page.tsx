import { Suspense } from 'react';

import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/layout/AuthShell';
import { PageSkeleton } from '@/components/states';
import { TwoFactorChallengeForm } from '@/features/auth/components/TwoFactorChallengeForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.twoFactor' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.twoFactor(locale),
    noIndex: true,
  });
}

/**
 * `/two-factor` — the S-8 challenge.
 *
 * The session behind this page is `twofaPending`: it exists, and it reaches nothing but
 * `POST /auth/2fa/challenge` and `POST /auth/2fa/recovery`. This page therefore resolves no
 * session server-side and displays no account detail — there is nothing safe to show yet, and
 * showing a name here would confirm the password to whoever typed it.
 */
export default async function AuthTwoFactorPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.twoFactor' });

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      {/* Same reason as `/login`: the form carries `?from=` through the challenge. */}
      <Suspense fallback={<PageSkeleton variant="form" count={1} />}>
        <TwoFactorChallengeForm locale={locale} />
      </Suspense>
    </AuthShell>
  );
}
