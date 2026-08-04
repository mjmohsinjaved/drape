'use client';

import { useSyncExternalStore } from 'react';

/**
 * Subscribes to a media query without the mount-flash a `useState` + `useEffect` pair causes.
 * On the server it reports `false`, so a layout that needs to differ must render both branches
 * and hide one with CSS rather than depending on this during SSR.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** §6.2: below 768 px the admin tables collapse to stacked cards. */
export function useIsCompactViewport(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

/**
 * §6.1: the `compact` admin density is offered only when a fine pointer is present, so the
 * 44 x 44 px touch-target floor (D-10) can never be violated on a phone.
 */
export function useHasFinePointer(): boolean {
  return useMediaQuery('(pointer: fine)');
}
