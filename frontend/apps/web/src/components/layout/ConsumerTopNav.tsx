'use client';

import { useTranslations } from 'next-intl';

import { consumerPrimaryNav, consumerSecondaryNav } from '@/components/layout/nav-items';
import { NavLink } from '@/components/layout/NavLink';

import type { Locale } from '@/i18n/config';

export interface ConsumerTopNavProps {
  locale: Locale;
}

/**
 * The desktop counterpart of the bottom tab bar (C-9). Hidden below 768 px, where `MobileNav`
 * takes over — the same destinations, placed where the hand or the cursor expects them.
 */
export function ConsumerTopNav({ locale }: ConsumerTopNavProps) {
  const t = useTranslations('common.nav');

  return (
    <nav aria-label={t('primaryLabel')} className="hidden md:block">
      <ul className="flex items-center gap-1">
        {[...consumerPrimaryNav, ...consumerSecondaryNav].map((item) => (
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
