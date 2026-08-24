import { AdminDensityRoot } from '@/components/layout/AdminDensityRoot';
import { Sidebar } from '@/components/layout/Sidebar';
import { SkipLink, MAIN_CONTENT_ID } from '@/components/layout/SkipLink';
import { Topbar } from '@/components/layout/Topbar';

import type { Locale } from '@/i18n/config';
import type { ReactNode } from 'react';

export interface AdminShellProps {
  locale: Locale;
  user: { name: string; email: string; initials: string };
  children: ReactNode;
}
export function AdminShell({ locale, user, children }: AdminShellProps) {
  return (
    <AdminDensityRoot className="flex min-h-dvh flex-col bg-canvas">
      <SkipLink />
      <Topbar locale={locale} user={user} />

      <div className="flex flex-1">
        <div className="h-below-topbar sticky top-14 hidden lg:flex">
          <Sidebar locale={locale} />
        </div>

        <main id={MAIN_CONTENT_ID} className="min-w-0 flex-1 px-4 pb-16 pt-4">
          <div className="mx-auto flex w-full max-w-admin flex-col gap-4">{children}</div>
        </main>
      </div>
    </AdminDensityRoot>
  );
}
