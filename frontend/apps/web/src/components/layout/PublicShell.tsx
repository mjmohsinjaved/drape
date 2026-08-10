import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { MobileNav } from '@/components/layout/MobileNav';
import { browsePrimaryNav } from '@/components/layout/nav-items';
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
  /**
   * Present when the visitor happens to be signed in. Browsing is public either way (C-1); the
   * only difference is that the header offers the account menu instead of a sign-in call.
   */
  user?: { name: string; email: string; initials: string };
}

/**
 * The browse shell (§6.6) — a slim top bar and a sign-in call to action while signed out.
 *
 * Browsing is genuinely public (C-1): the catalog, categories, search, filters and garment
 * detail all work here without an account. Only the actions that involve her photo ask her to
 * sign in, and the call to action says what she gets rather than what she must do.
 *
 * ### Signed in, this shell carries the fitting room's navigation
 *
 * C-9 asks for navigation that is "persistent and identical in both places" — Browse,
 * Shortlist, My try-ons — as a bottom tab bar on a phone and the top bar from 768 px up.
 * `ConsumerShell` had it and this one did not, and the two shells split the surface exactly
 * down the middle of the journey: browse and garment detail are public routes, so a signed-in
 * consumer looking at a piece lost both bars and had no way back to her shortlist or her
 * previous try-ons without the account menu. The nav is the same list from `nav-items.ts`, so
 * the two shells cannot drift apart again.
 *
 * Signed out it stays slim. There is nothing to show a visitor with no shortlist and no
 * try-ons, and a row of links that all lead to a sign-in wall is worse than one clear
 * invitation.
 */
export function PublicShell({ locale, children, user }: PublicShellProps) {
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

          {user ? (
            <div className="mx-auto">
              <TopNav locale={locale} items={browsePrimaryNav} />
            </div>
          ) : (
            <nav aria-label={t('nav.primaryLabel')} className="ms-4 hidden md:block">
              <Link
                href={routes.browse(locale)}
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm"
              >
                {t('nav.browse')}
              </Link>
            </nav>
          )}

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

      {/*
        `pb-tabbar` reserves the fixed tab bar's height plus the iOS safe area, so the last card
        in the grid is not trapped behind it. Only applied when the bar is actually rendered.
      */}
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
          {/*
            The one line that must appear wherever a render can be seen: Drape is a shortlisting
            tool. It never promises accuracy and never says "see yourself in" (§9.4).
          */}
          <p className="max-w-prose">{t('footer.shortlistingNote')}</p>
          <p>{t('footer.copyright', { year: new Date().getFullYear(), name: APP_NAME })}</p>
        </div>
      </footer>

      {user ? <MobileNav locale={locale} /> : null}
    </div>
  );
}
