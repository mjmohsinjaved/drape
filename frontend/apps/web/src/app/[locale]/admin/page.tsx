import { redirect } from 'next/navigation';

import { routes } from '@/lib/routes';

import type { LocaleParams } from '@/lib/route-params';

/**
 * `/admin` has no landing of its own (§6.6). There is exactly one dashboard URL and both roles
 * use it (S-2), so this segment forwards to it — the admin's home is `/dashboard`, rendered in
 * the console shell.
 *
 * The redirect happens after `admin/layout.tsx` has already required an admin session, so a
 * consumer never reaches this line: she is at `/no-access` (S-9).
 */
export default async function AdminIndexPage({ params }: LocaleParams) {
  const { locale } = await params;
  redirect(routes.dashboard(locale));
}
