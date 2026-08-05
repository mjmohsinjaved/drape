import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/layout/AuthShell';
import { SignupForm } from '@/features/auth/components/SignupForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.signup' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.signup(locale),
    noIndex: true,
  });
}

/**
 * `/signup` — C-2, S-4. Creates a Consumer account and only a Consumer account.
 *
 * The form asks for name, email, password and phone. Event date, event type and budget band
 * are prompted later, in context, on the account screen — not here.
 */
export default async function AuthSignupPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.signup' });

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      <SignupForm locale={locale} />
    </AuthShell>
  );
}
