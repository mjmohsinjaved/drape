import { Suspense } from 'react';

import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/layout/AuthShell';
import { PageSkeleton } from '@/components/states';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.login' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.login(locale),
    noIndex: true,
  });
}

/**
 * `/login` — the one sign-in URL for both roles (S-1).
 *
 * A Server Component shell around a client form island: the card, the heading, the metadata and
 * the language switch are server-rendered, and `'use client'` reaches no further than the
 * fields themselves.
 *
 * The caller is never asked which kind of account they hold, and nothing on this page differs
 * for an admin and a consumer.
 */
export default async function AuthLoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.login' });

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.signup(locale)}>{t('footerSignup')}</Link>}
    >
      {/*
        The form reads `?from=` to send the user back where they were heading, so it needs a
        Suspense boundary: this segment is statically prerendered (the locale layout declares
        `generateStaticParams`), and the search params only exist once the request does.
      */}
      <Suspense fallback={<PageSkeleton variant="form" count={2} />}>
        <LoginForm locale={locale} />
      </Suspense>
    </AuthShell>
  );
}
