import { AdminShortcuts } from '@/components/layout/AdminShortcuts';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Sidebar } from '@/components/layout/Sidebar';
import { SkipLink, MAIN_CONTENT_ID } from '@/components/layout/SkipLink';
import { Topbar } from '@/components/layout/Topbar';

import type { Locale } from '@/i18n/config';
import type { ReactNode } from 'react';

export interface AdminShellProps {
  locale: Locale;
  user: { name: string; email: string; initials: string };
  children: ReactNode;
  /** Labels for id-shaped breadcrumb segments, keyed by the raw path segment. */
  breadcrumbOverrides?: Readonly<Record<string, string>>;
}

/**
 * The admin console shell — ARCHITECTURE §6.2, PRD D-4.
 *
 * Dense and tabular, built for repetitive work: a fixed 264 px rail (72 px collapsed), a 56 px
 * top bar, a breadcrumb on every screen, and a 1680 px container that runs full-bleed inside
 * the shell. The vertical rhythm comes from the density scale, so `compact` tightens the whole
 * console at once rather than screen by screen (§6.1).
 *
 * It is a Server Component. The only client islands are the rail (it holds collapse and
 * density), the breadcrumb (it reads the pathname), the four top-bar controls, and the
 * shortcut listener.
 *
 * **D-9**: it stays usable on a phone for enquiry handling and approvals — the rail moves into
 * a drawer rather than disappearing, and no control drops below 44 x 44 px.
 * **D-19**: `AdminShortcuts` is mounted here, so `/` works from any admin screen.
 *
 * Rendering this shell is a presentation decision made from the server-resolved role. It is
 * never the authorisation decision (S-3, B-10) — the API authorises every operation beneath it.
 */
export function AdminShell({ locale, user, children, breadcrumbOverrides }: AdminShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SkipLink />
      <AdminShortcuts />
      <Topbar locale={locale} user={user} />

      <div className="flex flex-1">
        {/* The rail is hidden below 1024 px, where `AdminMobileMenu` presents the same list. */}
        <aside className="h-below-topbar sticky top-14 hidden lg:flex">
          <Sidebar locale={locale} />
        </aside>

        <main id={MAIN_CONTENT_ID} className="min-w-0 flex-1 px-4 pb-16 pt-4">
          <div className="mx-auto flex w-full max-w-admin flex-col gap-4">
            <Breadcrumbs locale={locale} overrides={breadcrumbOverrides} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
