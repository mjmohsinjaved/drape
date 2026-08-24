import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { AdminMobileMenu } from '@/components/layout/AdminMobileMenu';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { UserMenu } from '@/components/layout/UserMenu';
import { APP_NAME } from '@/lib/constants';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface TopbarProps {
  locale: Locale;
  user: { name: string; email: string; initials: string };
}

export function Topbar({ locale, user }: TopbarProps) {
  const t = useTranslations('admin.nav');

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface-raised px-4">
      <AdminMobileMenu locale={locale} />

      <Link
        href={routes.dashboard(locale)}
        className="inline-flex min-h-11 items-center text-sm font-semibold"
      >
        {APP_NAME}
        <span className="sr-only">{t('consoleLabel')}</span>
      </Link>

      <div className="ms-auto flex items-center gap-1">
        <LocaleSwitcher variant="icon" />
        <ThemeToggle />
        <UserMenu locale={locale} name={user.name} email={user.email} initials={user.initials} />
      </div>
    </header>
  );
}
