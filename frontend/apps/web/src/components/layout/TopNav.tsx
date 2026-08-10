'use client';

import { useTranslations } from 'next-intl';

import { NavLink } from '@/components/layout/NavLink';

import type { NavItem } from '@/components/layout/nav-items';
import type { Locale } from '@/i18n/config';

export interface TopNavProps {
  locale: Locale;
  /**
   * Which destinations to show. The **only** difference between the two shells' navigation, so
   * it is a prop rather than a second component: `PublicShell` and `ConsumerShell` split the
   * consumer journey down the middle — browse and garment detail are public routes — and two
   * near-identical nav components either side of that seam is how they drift apart.
   */
  items: readonly NavItem[];
}

/**
 * The desktop counterpart of the bottom tab bar (C-9), for whichever shell is rendering.
 *
 * Hidden below 768 px, where `MobileNav` takes over — the same destinations, placed where the
 * hand or the cursor expects them. Labels are message keys under `common.nav`, resolved here, so
 * the same item reads correctly in `en` and `ur`.
 */
export function TopNav({ locale, items }: TopNavProps) {
  const t = useTranslations('common.nav');

  return (
    <nav aria-label={t('primaryLabel')} className="hidden md:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => (
          <li key={item.key}>
            <NavLink
              href={item.href(locale)}
              matchPrefix={item.matchPrefix ?? false}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-ink-muted hover:bg-surface-sunken hover:text-ink"
              activeClassName="text-brand font-semibold"
            >
              {t(item.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
