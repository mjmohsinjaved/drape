import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Button, EmptyState } from '@repo/ui';

import { AuthShell } from '@/components/layout/AuthShell';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.resetPassword' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.resetPassword(locale),
    noIndex: true,
  });
}

/**
 * `/reset-password` with no token.
 *
 * Someone lands here by trimming the URL, or by opening a link that lost its token in a mail
 * client. There is nothing to submit — the token is the credential and it only arrives by
 * email — so this is the **empty** state of the reset flow, and D-6 says an empty state names
 * the next action rather than reporting the absence. It sends them to request a fresh link.
 *
 * No field asks for the token. A credential in an editable box invites someone to paste one
 * that was sent to a different address.
 */
export default async function AuthResetPasswordPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.resetPassword' });

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      <EmptyState
        size="inline"
        headingLevel="h2"
        title={t('emptyTitle')}
        description={t('emptyBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.forgotPassword(locale)}>{t('footerForgot')}</Link>
          </Button>
        }
      />
    </AuthShell>
  );
}
