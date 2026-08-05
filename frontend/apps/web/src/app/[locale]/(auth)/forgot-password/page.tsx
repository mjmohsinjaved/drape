import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/layout/AuthShell';
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.forgotPassword' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.forgotPassword(locale),
    noIndex: true,
  });
}

/**
 * `/forgot-password` — S-6.
 *
 * The API answers identically whether or not the address has an account, and so does this
 * screen. Nothing here, in any state, tells a visitor which addresses exist.
 */
export default async function AuthForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.forgotPassword' });

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      <ForgotPasswordForm locale={locale} />
    </AuthShell>
  );
}
