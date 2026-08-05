import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/layout/AuthShell';
import { ConfirmEmailToken } from '@/features/auth/components/EmailVerification';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParamsWith } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParamsWith<{ token: string }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, token } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.verifyEmailToken' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.verifyEmailToken(locale, token),
    noIndex: true,
  });
}

/**
 * `/verify-email/[token]` — C-3.
 *
 * ARCHITECTURE §6.6 sketches this segment as consuming the token during the server render.
 * It does not, deliberately: the token is **single use**, and mail clients, corporate link
 * scanners and messaging previews fetch every URL in a message. A token spent by a render is
 * already gone by the time the reader presses the link. One deliberate press costs a tap and
 * makes the link work.
 *
 * The confirmation is also a mutation, and a mutation in a render is not something to reach for
 * regardless.
 */
export default async function AuthVerifyEmailTokenPage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.verifyEmailToken' });

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      <ConfirmEmailToken locale={locale} token={token} />
    </AuthShell>
  );
}
