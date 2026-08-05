import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState } from '@repo/ui';

import { accountApi } from '@/features/account/api/paths';
import { AccountSections } from '@/features/account/components/AccountSections';
import { EventDetailsForm } from '@/features/account/components/EventDetailsForm';
import { PhoneVerification } from '@/features/account/components/PhoneVerification';
import { ProfileForm } from '@/features/account/components/ProfileForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { ConsumerProfile, MyAccount } from '@/features/account/api/types';
import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account.profile' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.account(locale),
  });
}

/**
 * `/account` — profile (C-7), and the C-2 event details asked here rather than at signup.
 *
 * The reads happen server-side through `@repo/api-client`'s cookie-forwarding instance (B-9);
 * the forms are client islands seeded with what the server already fetched, so nothing
 * flashes a skeleton for data the page was rendered with.
 *
 * The consumer layout above has already resolved the session and would have redirected an
 * admin to `/dashboard`. This page re-reads nothing about permissions — the API authorises
 * every one of these calls on its own (S-3).
 *
 * ### The six D-5 states
 * - **default** — the three panels.
 * - **loading** — `loading.tsx` beside this file.
 * - **empty** — the unanswered event details, which is a normal state and not a failure.
 * - **error** — the read failed: `ErrorState`, with the retry the boundary already provides.
 * - **permission denied** — handled by the layout's server-side role check (S-9).
 * - **success** — each form confirms its own save.
 */
export default async function ConsumerAccountPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'account.profile' });

  const [accountResult, profileResult] = await Promise.all([
    serverGet<MyAccount>(accountApi.me),
    serverGet<ConsumerProfile>(accountApi.profile),
  ]);

  if (!accountResult.ok) {
    return (
      <ErrorState
        title={t('loadErrorTitle')}
        description={t('loadErrorBody')}
        headingLevel="h2"
      />
    );
  }

  const account = accountResult.data;

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-balance text-ink">{t('title')}</h1>
        <p className="max-w-prose text-base text-ink-muted">{t('description')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            {t('detailsTitle')}
          </CardTitle>
          <CardDescription>{t('detailsDescription', { email: account.email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm account={account} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            {t('phoneTitle')}
          </CardTitle>
          <CardDescription>{t('phoneDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneVerification locale={locale} account={account} />
        </CardContent>
      </Card>

      {profileResult.ok ? (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="text-lg">
              {t('eventTitle')}
            </CardTitle>
            <CardDescription>{t('eventDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <EventDetailsForm profile={profileResult.data} />
          </CardContent>
        </Card>
      ) : null}

      <AccountSections locale={locale} />
    </section>
  );
}
