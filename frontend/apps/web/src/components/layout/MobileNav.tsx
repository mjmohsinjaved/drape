'use client';

import { useTranslations } from 'next-intl';

import { NavLink } from '@/components/layout/NavLink';
import { consumerPrimaryNav } from '@/components/layout/nav-items';

import type { Locale } from '@/i18n/config';

export interface MobileNavProps {
  locale: Locale;
}

/**
 * The consumer bottom tab bar — PRD C-9: Browse, Shortlist, My try-ons, Account.
 *
 * Mobile only; above 768 px the same four live in the top bar. 56 px tall (§6.2), each target
 * at least 44 x 44 px (D-10), and it sits above the home-indicator area on iOS via
 * `pb-[env(safe-area-inset-bottom)]`'s logical equivalent below.
 *
 * The label is always visible under the icon: an icon alone is not a label.
 */
export function MobileNav({ locale }: MobileNavProps) {
  const t = useTranslations('common.nav');

  return (
    <nav
      aria-label={t('primaryLabel')}
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-raised md:hidden"
    >
      <ul className="mx-auto flex h-14 max-w-2xl items-stretch justify-around">
        {consumerPrimaryNav.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.key} className="flex flex-1">
              <NavLink
                href={item.href(locale)}
                matchPrefix={item.matchPrefix ?? false}
                className="flex min-h-11 w-full flex-col items-center justify-center gap-1 px-2 text-2xs text-ink-muted"
                activeClassName="text-brand font-semibold"
              >
                <Icon aria-hidden="true" className="size-5" />
                <span>{t(item.labelKey)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
