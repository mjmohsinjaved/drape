import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { ConsumerTopNav } from '@/components/layout/ConsumerTopNav';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { MobileNav } from '@/components/layout/MobileNav';
import { SkipLink, MAIN_CONTENT_ID } from '@/components/layout/SkipLink';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { UserMenu } from '@/components/layout/UserMenu';
import { APP_NAME } from '@/lib/constants';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';
import type { ReactNode } from 'react';

export interface ConsumerShellProps {
  locale: Locale;
  /** Absent while signed out — the browse surface is public (C-1). */
  user?: { name: string; email: string; initials: string };
  children: ReactNode;
}

/**
 * The consumer fitting room shell — ARCHITECTURE §6.2, PRD D-4.
 *
 * Image-led and generous with space: a 1200 px centred container, gutters that open up as the
 * screen grows, and a vertical rhythm one and a half times the admin's for the same semantic
 * gap. Mobile-first — this is designed at 360 px and then allowed to breathe (D-9).
 *
 * Navigation is persistent and identical in both places (C-9): Browse, Shortlist, My try-ons,
 * Account — a bottom tab bar on a phone, the top bar from 768 px up.
 *
 * A Server Component. The tab bar, the top nav, the language and theme controls and the
 * account menu are the only client islands.
 */
export function ConsumerShell({ locale, user, children }: ConsumerShellProps) {
  const t = useTranslations('common');

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SkipLink />

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-consumer items-center gap-4 px-5 md:px-8 xl:px-12">
          <Link
            href={routes.home(locale)}
            className="inline-flex min-h-11 items-center text-xl font-semibold"
          >
            {APP_NAME}
          </Link>

          <div className="mx-auto">
            <ConsumerTopNav locale={locale} />
          </div>

          <div className="ms-auto flex items-center gap-1">
            <LocaleSwitcher variant="icon" />
            <ThemeToggle />
            {user ? (
              <UserMenu
                locale={locale}
                name={user.name}
                email={user.email}
                initials={user.initials}
              />
            ) : (
              <Button asChild variant="primary" size="sm">
                <Link href={routes.login(locale)}>{t('actions.signIn')}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/*
        `pb-tabbar` reserves the height of the fixed tab bar plus the iOS safe area, so the last
        card in a list is never trapped behind it.
      */}
      <main
        id={MAIN_CONTENT_ID}
        className="pb-tabbar mx-auto w-full max-w-consumer flex-1 px-5 pt-6 md:px-8 md:pb-16 md:pt-10 xl:px-12"
      >
        {children}
      </main>

      <MobileNav locale={locale} />
    </div>
  );
}
