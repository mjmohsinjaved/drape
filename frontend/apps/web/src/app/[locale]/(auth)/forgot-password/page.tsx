import { Callout } from '@repo/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { AuthShell } from '@/components/layout/AuthShell';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';

import type { Metadata } from 'next';
import type { LocaleParams } from '@/lib/route-params';

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
      {/*
        ══ TODO(W1) — form insertion point ══
        Replace this notice with the client form island. The shell, the layout, the metadata
        and the states around it are finished; only the form itself is outstanding.
        The form must: validate with zod, surface field errors through `errors[]` from the
        API envelope (§2.3), display the server's message verbatim (it is already user-safe),
        keep every control at least 44 x 44 px, and never distinguish an unknown email from a
        wrong password (S-6).
      */}
      <Callout variant="info" title={t('todoTitle')}>
        {t('todoBody')}
      </Callout>
    </AuthShell>
  );
}
