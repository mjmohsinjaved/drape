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

/** Nobody's account is indexed. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * ═══ The account segment — role-ANY ═══
 *
 * `/me`, the password change and two-factor enrolment are role-ANY in §5.2, and S-8 makes a
 * second factor **mandatory for admins**. So these screens cannot live inside `(consumer)`,
 * whose layout redirects an admin to `/dashboard`: that put the one role obliged to enrol on the
 * only surface with nowhere to do it.
 *
 * Moving the segment out of the group keeps every URL exactly as it was — a route group never
 * appears in the path, so `/account`, `/account/security`, `/account/notifications` and
 * `/account/data` are unchanged for links, the account menu, `lib/routes.ts` and the middleware.
 *
 * **ARCHITECTURE §6.6 still files `account/**` under `(consumer)` and should be corrected.**
 *
 * Like `/dashboard`, this resolves the role server-side (S-3) and renders the shell that matches
 * it: the console for an admin, the fitting room for a consumer. That is a presentation decision
 * and never the authorisation decision — the API authorises each of these reads and writes on
 * its own (B-10), and it is the API that decides what an admin may see about their own account.
 */
export default async function AccountLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Either shell can render here, so the provider carries both vocabularies. The role decides
  // which shell, never what is permitted.
  const [user, messages] = await Promise.all([
    requireUser(locale),
    loadClientMessages(locale, 'account'),
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
