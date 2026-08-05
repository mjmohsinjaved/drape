import { getTranslations, setRequestLocale } from 'next-intl/server';

import { accountPaths, authPaths ,type  MyAccount,type  SessionSummary } from '@repo/api-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState } from '@repo/ui';

import { ChangePasswordForm } from '@/features/account/components/ChangePasswordForm';
import { SessionsPanel } from '@/features/account/components/SessionsPanel';
import { TwoFactorSettings } from '@/features/account/components/TwoFactorSettings';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account.security' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.accountSecurity(locale),
  });
}

/**
 * `/account/security` — password, two-factor authentication and live sessions (C-7, S-8).
 *
 * Both reads are server-side and cookie-forwarded (B-9); the three panels below are client
 * islands only because each of them writes.
 *
 * ### The six D-5 states
 * - **default** — the three panels.
 * - **loading** — `loading.tsx` beside this file.
 * - **empty** — the sessions panel handles a list with nothing in it (D-6).
 * - **error** — a failed read renders `ErrorState`; a failed write is handled in its panel.
 * - **permission denied** — the segment is role-ANY (§5.2), so the state that applies is the
 *   API refusing an individual call; it renders as that panel's error copy, never a raw 403 (S-9).
 * - **success** — each panel confirms its own action in the same words (D-13).
 */
export default async function AccountSecurityPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'account.security' });

  const [accountResult, sessionsResult] = await Promise.all([
    serverGet<MyAccount>(accountPaths.me),
    serverGet<SessionSummary[]>(authPaths.sessions),
  ]);

  if (!accountResult.ok) {
    return (
      <ErrorState title={t('loadErrorTitle')} description={t('loadErrorBody')} headingLevel="h2" />
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-balance text-ink">{t('title')}</h1>
        <p className="max-w-prose text-base text-ink-muted">{t('description')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            {t('passwordTitle')}
          </CardTitle>
          <CardDescription>{t('passwordDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            {t('twofaTitle')}
          </CardTitle>
          <CardDescription>{t('twofaDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSettings account={accountResult.data} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            {t('sessionsTitle')}
          </CardTitle>
          <CardDescription>{t('sessionsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsResult.ok ? (
            <SessionsPanel sessions={sessionsResult.data} />
          ) : (
            <ErrorState
              size="inline"
              headingLevel="h3"
              title={t('sessionsErrorTitle')}
              description={t('sessionsErrorBody')}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
