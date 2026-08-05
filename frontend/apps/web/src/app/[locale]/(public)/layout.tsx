import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';

import { PublicShell } from '@/components/layout/PublicShell';
import { timeZone } from '@/i18n/config';
import { loadClientMessages } from '@/i18n/messages';
import { getCurrentUser, toShellUser } from '@/lib/session';

import type { LayoutProps } from '@/lib/route-params';

/**
 * The public shell (§6.6): slim top bar, sign-in call to action.
 *
 * Everything under this layout is reachable while signed out (C-1). The session is read only
 * to decide whether the header shows a sign-in button or the account menu — it gates nothing.
 *
 * The client provider here carries `browse` and `tryon` on top of the base chrome — the filter
 * island and the try-on tray, and nothing else. This is the §9.1 route: everything in the
 * provider is bytes in the HTML of the catalog grid, and the console's 39.5 KB is not among
 * them. The two reads below run together for the same reason.
 */
export default async function PublicLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [user, messages] = await Promise.all([
    getCurrentUser(),
    loadClientMessages(locale, 'public'),
  ]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <PublicShell locale={locale} user={user ? toShellUser(user) : undefined}>
        {children}
      </PublicShell>
    </NextIntlClientProvider>
  );
}
