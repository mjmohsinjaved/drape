import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ErrorState } from '@repo/ui';

import { accountApi } from '@/features/account/api/paths';
import { NotificationPreferencesForm } from '@/features/account/components/NotificationPreferencesForm';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type { NotificationPreferences } from '@/features/account/api/types';
import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParams;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account.notifications' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.accountNotifications(locale),
  });
}

/**
 * `/account/notifications` — C-7.
 *
 * Read server-side, written by the client island one key at a time. Marketing is off unless she
 * turns it on: defaulting a promotional channel to on is opt-out marketing, and the API's
 * defaults reflect that.
 *
 * ### The six D-5 states
 * - **default** — the four switches.
 * - **loading** — `loading.tsx`, then the per-switch busy state.
 * - **empty** — not applicable; the set of preferences is fixed.
 * - **error** — a failed read here, a failed write with rollback inside the island (D-18).
 * - **permission denied** — handled by the layout's server-side role check (S-9).
 * - **success** — the quiet inline confirmation an auto-saving control earns.
 */
export default async function ConsumerAccountNotificationsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'account.notifications' });
  const result = await serverGet<NotificationPreferences>(accountApi.notificationPreferences);

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold text-balance text-ink">{t('title')}</h1>
        <p className="max-w-prose text-base text-ink-muted">{t('description')}</p>
      </header>

      {result.ok ? (
        <NotificationPreferencesForm preferences={result.data} />
      ) : (
        <ErrorState title={t('loadErrorTitle')} description={t('loadErrorBody')} headingLevel="h2" />
      )}
    </section>
  );
}
