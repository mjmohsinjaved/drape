import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { HeaderQuotaPill } from '@/components/layout/HeaderQuotaPill';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { MobileNav } from '@/components/layout/MobileNav';
import { consumerPrimaryNav, consumerSecondaryNav } from '@/components/layout/nav-items';
import { SkipLink, MAIN_CONTENT_ID } from '@/components/layout/SkipLink';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { TopNav } from '@/components/layout/TopNav';
import { UserMenu } from '@/components/layout/UserMenu';
import { APP_NAME } from '@/lib/constants';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { ReactNode } from 'react';

export interface PublicShellProps {
  locale: Locale;
  children: ReactNode;
  user?: { name: string; email: string; initials: string };
}

export function PublicShell({ locale, children, user }: PublicShellProps) {
  const t = useTranslations('common');

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SkipLink />

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="flex h-16 w-full items-center">
          <div className="topbar-lead flex shrink-0 items-center">
            <Link
              href={routes.home(locale)}
              className="inline-flex min-h-11 items-center text-xl font-semibold"
            >
              {APP_NAME}
            </Link>
          </div>

          {user ? (
            <div className="-ms-3">
              <TopNav locale={locale} items={consumerPrimaryNav} />
            </div>
          ) : (
            <nav aria-label={t('nav.primaryLabel')} className="-ms-3 hidden md:block">
              <Link
                href={routes.browse(locale)}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm"
              >
                {t('nav.browse')}
              </Link>
            </nav>
          )}

          <div className="ms-auto flex items-center gap-1 pe-5 md:pe-8 xl:pe-12">
            {user ? <span className="me-2"><HeaderQuotaPill /></span> : null}
            <LocaleSwitcher variant="icon" />
            <ThemeToggle />
            {user ? (
              <UserMenu
                locale={locale}
                name={user.name}
                email={user.email}
                initials={user.initials}
                extraItems={consumerSecondaryNav.map((item) => ({
                  key: item.key,
                  label: t(`nav.${item.labelKey}`),
                  href: item.href(locale),
                }))}
              />
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href={routes.login(locale)}>{t('actions.signIn')}</Link>
                </Button>
                <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
                  <Link href={routes.signup(locale)}>{t('actions.signUp')}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main
        id={MAIN_CONTENT_ID}
        className={`mx-auto w-full max-w-consumer flex-1 px-5 pt-6 md:px-8 md:pb-16 md:pt-10 xl:px-12 ${
          user ? 'pb-tabbar' : 'pb-16'
        }`}
      >
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-consumer flex-col gap-2 px-5 py-8 text-sm text-ink-muted md:px-8 xl:px-12">
          <p className="max-w-prose">{t('footer.shortlistingNote')}</p>
          <p>{t('footer.copyright', { year: new Date().getFullYear(), name: APP_NAME })}</p>
        </div>
      </footer>

      {user ? <MobileNav locale={locale} /> : null}
    </div>
  );
}
