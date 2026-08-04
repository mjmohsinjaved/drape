'use client';

import { useLocale } from 'next-intl';

import { direction, toLocale } from '@/i18n/config';

/**
 * The active writing direction.
 *
 * Layout never needs this — every component uses logical CSS properties, so RTL is free
 * (§6.7). It exists for the few things CSS cannot express: a `scaleX(-1)` on a directional
 * icon, a drag axis, a chart's reading order.
 */
export function useDirection(): 'ltr' | 'rtl' {
  return direction[toLocale(useLocale())];
}

export function useIsRtl(): boolean {
  return useDirection() === 'rtl';
}
