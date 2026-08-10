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
 *
 * ### A Server Component, and it has to be
 *
 * `NavItem` carries `href: (locale) => string` and `icon: LucideIcon` — a function and a
 * component. Taking `items` as a prop only works if this side of the call is *not* a client
 * boundary: mark it `'use client'` and React has to serialise that array to send it, cannot,
 * and throws `Functions cannot be passed directly to Client Components` for the whole shell.
 * The predecessors got away with `'use client'` because each imported its own list rather than
 * receiving one.
 *
 * So the boundary sits one level down, at `NavLink`, which needs `usePathname` to know what is
 * active and takes nothing but strings and booleans. Rendering a client component from a server
 * component is free; passing behaviour into one is not.
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
