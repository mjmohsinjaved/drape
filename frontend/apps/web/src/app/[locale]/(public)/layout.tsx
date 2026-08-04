import { setRequestLocale } from 'next-intl/server';

import { PublicShell } from '@/components/layout/PublicShell';
import { getCurrentUser, toShellUser } from '@/lib/session';

import type { LayoutProps } from '@/lib/route-params';

/**
 * The public shell (§6.6): slim top bar, sign-in call to action.
 *
 * Everything under this layout is reachable while signed out (C-1). The session is read only
 * to decide whether the header shows a sign-in button or the account menu — it gates nothing.
 */
export default async function PublicLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();

  return (
    <PublicShell locale={locale} user={user ? toShellUser(user) : undefined}>
      {children}
    </PublicShell>
  );
}
