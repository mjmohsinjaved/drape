import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/layout/AuthShell';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParamsWith } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParamsWith<{ token: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.resetPasswordToken' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.resetPasswordToken(locale, token),
    noIndex: true,
  });
}

/**
 * `/reset-password/[token]` — S-6.
 *
 * The token is **not** validated on render. `POST /auth/password/reset` consumes it in the same
 * call that sets the password, and it is single use: a validating probe would either burn it
 * before the reader had typed anything, or become a free oracle for guessing tokens. So the
 * screen renders the form, and the one call that matters decides.
 */
export default async function AuthResetPasswordTokenPage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.resetPasswordToken' });

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      <ResetPasswordForm locale={locale} token={token} />
    </AuthShell>
  );
}
