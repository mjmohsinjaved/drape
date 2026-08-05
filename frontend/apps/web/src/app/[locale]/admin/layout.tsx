import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { AdminShell } from '@/components/layout/AdminShell';
import { SessionSync } from '@/components/providers/SessionSync';
import { timeZone } from '@/i18n/config';
import { loadClientMessages } from '@/i18n/messages';
import { requireAdmin, toShellUser } from '@/lib/session';

import type { LayoutProps } from '@/lib/route-params';
import type { Metadata } from 'next';

/** The console is never indexed. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The admin console (§6.6).
 *
 * The role is resolved server-side from the session on every request (S-3). A consumer who
 * reaches any admin URL goes to `/no-access` — a clear screen with a link back to the fitting
 * room, never a raw 403 (S-9). Every admin URL resolves to that same screen, so watching where
 * the browser lands reveals nothing about whether the resource exists.
 *
 * Rendering the admin shell is presentation. The API authorises every operation beneath it and
 * is the sole authority (B-10).
 */
export default async function AdminLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // `admin` is the big one, and this is the only group whose readers can use it.
  const [user, messages] = await Promise.all([
    requireAdmin(locale),
    loadClientMessages(locale, 'admin'),
  ]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <SessionSync user={user} />
      <AdminShell locale={locale} user={toShellUser(user)}>
        {children}
      </AdminShell>
    </NextIntlClientProvider>
  );
}
