'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { useAdminDensity } from '@repo/store';

export interface AdminDensityRootProps {
  children: ReactNode;
  className?: string;
}

/**
 * Writes `data-density` for the whole admin surface — ARCHITECTURE §6.1/§6.2, PRD D-4.
 *
 * `@repo/config-tailwind/density.css` scopes the entire `--density-*` scale to `[data-density]`,
 * and `@repo/ui`'s `h-row`, `min-h-row`, `p-cell`, `text-density`, `gap-stack` and `gap-section`
 * utilities all read it. Nothing but this component writes the attribute, and it wraps the whole
 * shell — rail, top bar and page — so the compact toggle in the rail retimes the console in one
 * step instead of screen by screen.
 *
 * **The `(pointer: fine)` gate stays in CSS, not here.** `compact` is written to the DOM
 * unconditionally; `density.css` simply declines to apply the compact values on a coarse pointer,
 * so a preference set on a desktop and carried onto a phone cannot shrink a control below the
 * 44 x 44 px floor (D-10). Filtering the attribute in JS instead would move that guarantee into a
 * media-query listener that can be wrong for a frame — CSS is never wrong for a frame.
 *
 * The value is only adopted after mount. `useUiStore` rehydrates from `localStorage`
 * synchronously in the browser, so reading it during the first client render would disagree with
 * server-rendered markup that has no storage to read; comfortable is the correct, D-10-safe
 * value to paint until the preference is known.
 */
export function AdminDensityRoot({ children, className }: AdminDensityRootProps) {
  const density = useAdminDensity();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <div data-density={mounted ? density : 'comfortable'} className={className}>
      {children}
    </div>
  );
}
