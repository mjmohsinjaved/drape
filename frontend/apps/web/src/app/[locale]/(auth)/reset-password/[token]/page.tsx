import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Callout } from '@repo/ui';

import { AuthShell } from '@/components/layout/AuthShell';
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

export default async function AuthResetPasswordTokenPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.resetPasswordToken' });

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
      <Callout tone="info" title={t('todoTitle')}>
        {t('todoBody')}
      </Callout>
    </AuthShell>
  );
}
