import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { ConsumerShell } from '@/components/layout/ConsumerShell';
import { timeZone } from '@/i18n/config';
import { loadClientMessages } from '@/i18n/messages';
import { requireConsumer, toShellUser } from '@/lib/session';

import type { LayoutProps } from '@/lib/route-params';

/**
 * The consumer fitting room (§6.6).
 *
 * The session is resolved server-side here, on every request, by calling `/auth/me` — the
 * middleware's earlier redirect is a convenience and this layout never assumes it ran (S-3,
 * B-10). An admin who lands here is sent to `/dashboard`, which is the one URL both roles
 * share (S-2).
 *
 * This decides which interface renders. It decides nothing about permissions: every read and
 * every mutation below is independently authorised by the API.
 *
 * The client provider carries the fitting room's namespaces and, deliberately, not `admin` —
 * an admin who reaches here is redirected, so the console's copy has no reader below this point.
 */
export default async function ConsumerLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [user, messages] = await Promise.all([
    requireConsumer(locale),
    loadClientMessages(locale, 'consumer'),
  ]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <ConsumerShell locale={locale} user={toShellUser(user)}>
        {children}
      </ConsumerShell>
    </NextIntlClientProvider>
  );
}
