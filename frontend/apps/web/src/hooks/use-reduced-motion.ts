'use client';

import { useMediaQuery } from './use-media-query';

/**
 * D-11. The stylesheet already neutralises CSS transitions; this is for the cases CSS cannot
 * reach — a staged reveal, an auto-scrolling carousel, a count-up — which must present their
 * end state immediately instead of animating to it.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
