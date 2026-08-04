import { setRequestLocale } from 'next-intl/server';

import type { LayoutProps } from '@/lib/route-params';
import type { Metadata } from 'next';

/**
 * The authentication group (§6.6).
 *
 * The visible chrome — the centred card, the wordmark, the language switch — is `AuthShell`,
 * which each page renders with its own title and description. This layout exists to hold the
 * shared metadata defaults and to keep the group free of navigation: nothing here offers a way
 * deeper into the app, because there is nothing to go deeper into until she is signed in.
 *
 * There is one `/login` for both roles and she is never asked which kind of account she holds
 * (S-1).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function AuthLayout({ children, params }: LayoutProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <>{children}</>;
}
