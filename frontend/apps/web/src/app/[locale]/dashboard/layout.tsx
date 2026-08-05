import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { AdminShell } from '@/components/layout/AdminShell';
import { ConsumerShell } from '@/components/layout/ConsumerShell';
import { timeZone } from '@/i18n/config';
import { loadClientMessages } from '@/i18n/messages';
import { Role } from '@/lib/constants';
import { requireUser, toShellUser } from '@/lib/session';

import type { LayoutProps } from '@/lib/route-params';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * ═══ The S-2 switch ═══
 *
 * One dashboard route, two experiences. After authentication the role is resolved
 * **server-side** from the session and either the admin console or the consumer fitting room
 * renders. The URL is identical for both — nothing in it, and nothing the browser sends,
 * chooses the shell.
 *
 * S-3: the role comes from the session via `/auth/me` and is never read from a client-supplied
 * parameter, header, query string or any claim the client can influence. B-10: this selects
 * which interface to render and is never the authorisation decision — the API authorises every
 * operation independently.
 *
 * The two shells share the token set and nothing else (D-4): the console is dense and tabular,
 * the fitting room is image-led and generous.
 */
export default async function DashboardLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [user, messages] = await Promise.all([
    requireUser(locale),
    loadClientMessages(locale, 'dashboard'),
  ]);
  const shellUser = toShellUser(user);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {user.role === Role.ADMIN ? (
        <AdminShell locale={locale} user={shellUser}>
          {children}
        </AdminShell>
      ) : (
        <ConsumerShell locale={locale} user={shellUser}>
          {children}
        </ConsumerShell>
      )}
    </NextIntlClientProvider>
  );
}
