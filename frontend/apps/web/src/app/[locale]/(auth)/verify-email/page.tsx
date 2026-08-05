import Link from 'next/link';

import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthShell } from '@/components/layout/AuthShell';
import { RequestEmailVerification } from '@/features/auth/components/EmailVerification';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { getCurrentUser } from '@/lib/session';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth.verifyEmail' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.verifyEmail(locale),
    noIndex: true,
  });
}

/**
 * `/verify-email` with no token — "send me another link" (C-3).
 *
 * `POST /auth/email/verify/request` needs a session, so the session is resolved server-side
 * here and handed to the island as two plain facts. This is presentation state: it decides
 * which of the three states to draw and nothing else. The API refuses the request on its own
 * terms if the session is not what this page believed (S-3).
 *
 * A signed-out visitor is **not** redirected: this is a page someone reaches from an email
 * they opened on a different device, and bouncing them to `/login` without explanation is
 * worse than telling them plainly what is needed.
 */
export default async function AuthVerifyEmailPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'auth.verifyEmail' });
  const user = await getCurrentUser();

  return (
    <AuthShell
      locale={locale}
      title={t('title')}
      description={t('description')}
      footer={<Link href={routes.login(locale)}>{t('footerLogin')}</Link>}
    >
      <RequestEmailVerification
        locale={locale}
        isSignedIn={user !== null}
        alreadyVerified={user !== null && user.emailVerifiedAt !== null}
        email={user?.email ?? null}
      />
    </AuthShell>
  );
}
