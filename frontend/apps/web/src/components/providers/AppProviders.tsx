'use client';

import { QueryProvider } from '@repo/api-client';
import {
  DirectionProvider,
  NavigationPendingProvider,
  ThemeProvider,
  TooltipProvider,
} from '@repo/ui';

import { LinkPending } from '@/components/navigation/LinkPending';

import type { ReactNode } from 'react';

export interface AppProvidersProps {
  children: ReactNode;
  /** Resolved server-side from the `[locale]` segment — never negotiated in the browser. */
  direction: 'ltr' | 'rtl';
}

/**
 * The client boundary for the whole app, and the only one at the root.
 *
 * Order matters:
 *  1. `ThemeProvider`   — CSS custom properties must resolve before anything paints, and it
 *                         owns the light/dark class on <html> (§6.1).
 *  2. `DirectionProvider` — Radix needs `dir` to place its own popovers and menus correctly.
 *  3. `TooltipProvider` — one delay-group for the entire app.
 *  4. `NavigationPendingProvider` — the route-transition counter. It has to be above every
 *                         link in the document, because any of them can report into it, and
 *                         above `Button`, which asks it for the indicator to slot into an
 *                         `asChild` link. The bar it feeds is mounted lower down, inside the
 *                         locale segment, where its label resolves.
 *  5. `QueryProvider`   — the data layer, needed by every client island beneath it.
 *
 * Everything below stays a Server Component unless it genuinely needs state, a handler or a
 * browser API. `'use client'` lives at the leaf, not here.
 */
export function AppProviders({ children, direction }: AppProvidersProps) {
  return (
    <ThemeProvider defaultMode="system" storageKey="drape.ui">
      <DirectionProvider dir={direction}>
        <TooltipProvider>
          {/*
            `LinkPending` is injected rather than imported by the design system: `@repo/ui`
            never imports `next/link`, so the app hands it the one component that can read
            `useLinkStatus()`.
          */}
          <NavigationPendingProvider linkPending={LinkPending}>
            <QueryProvider>{children}</QueryProvider>
          </NavigationPendingProvider>
        </TooltipProvider>
      </DirectionProvider>
    </ThemeProvider>
  );
}
