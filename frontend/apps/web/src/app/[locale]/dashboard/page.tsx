import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminHome } from '@/app/[locale]/dashboard/_components/AdminHome';
import { ConsumerHome } from '@/app/[locale]/dashboard/_components/ConsumerHome';
import { Role } from '@/lib/constants';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { requireUser } from '@/lib/session';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common.dashboard' });

  return buildMetadata({
    locale,
    title: t('title'),
    description: t('description'),
    path: routes.dashboard(locale),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 *  THE S-2 SWITCH — ONE URL, TWO EXPERIENCES.
 *  ═══════════════════════════════════════════════════════════════════════════════════
 *
 *  The role is resolved **server-side**, from the session, by `requireUser()` → `/auth/me`
 *  (B-10). It is never read from a query string, a header, a cookie value the browser can
 *  set, or anything else a client can influence (S-3).
 *
 *  ── THIS BRANCH IS PRESENTATION. IT IS NOT THE AUTHORISATION DECISION. ──
 *
 *  All it decides is which landing renders. Every read and every write beneath it is
 *  independently authorised by the API, which re-reads `users.role` on each request and
 *  answers `INSUFFICIENT_ROLE` regardless of what this file drew. Someone who forced the
 *  admin branch to render would see a page of links and then a refusal behind every one of
 *  them; that is the design, not a hole in it (S-3, B-10, CLAUDE.md).
 *
 *  The layout above has already chosen the shell from the same resolved session, and the
 *  read is served from the same per-request cache — so this costs no second round trip.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ### The six D-5 states
 * - **default** — the role-appropriate landing.
 * - **loading** — `loading.tsx` beside this file.
 * - **empty** — not applicable; both landings are always populated.
 * - **error** — `error.tsx` beside this file.
 * - **permission denied** — signed out, `requireUser` sends the visitor to `/login` carrying
 *   where they were going. No role reaches this URL and is refused: that is the point of one
 *   dashboard for both (S-2).
 * - **success** — arriving here *is* the success state of signing in (C-4).
 */
export default async function DashboardPage({ params }: LocaleParams) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser(locale);

  if (user.role === Role.ADMIN) {
    return <AdminHome locale={locale} user={user} />;
  }

  return <ConsumerHome locale={locale} user={user} />;
}
