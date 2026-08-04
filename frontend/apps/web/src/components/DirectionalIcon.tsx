import { useLocale } from 'next-intl';

import { direction, toLocale } from '@/i18n/config';

import type { ReactNode } from 'react';

export interface DirectionalIconProps {
  children: ReactNode;
  className?: string;
}

/**
 * The one place an icon flips for RTL — ARCHITECTURE §6.7.
 *
 * Chevrons, arrows and back buttons point the way the text runs, so they mirror under `ur`.
 * Icons that are not directional — search, trash, plus — never flip and must not be wrapped.
 *
 * The flip is an inline `scaleX(-1)`, not a `[dir='rtl']` selector or an `rtl:` variant:
 * there are no per-side RTL overrides anywhere in this codebase.
 *
 * Renders on the server; `useLocale()` resolves from the request config, so no client
 * JavaScript is shipped for a mirrored arrow.
 */
export function DirectionalIcon({ children, className }: DirectionalIconProps) {
  const isRtl = direction[toLocale(useLocale())] === 'rtl';

  return (
    <span
      aria-hidden="true"
      className={className}
      style={isRtl ? { display: 'inline-flex', transform: 'scaleX(-1)' } : { display: 'inline-flex' }}
    >
      {children}
    </span>
  );
}
