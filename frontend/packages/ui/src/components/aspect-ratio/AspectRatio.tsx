'use client';

import * as React from 'react';

import * as AspectRatioPrimitive from '@radix-ui/react-aspect-ratio';

import { cn } from '../../lib/cn';

/**
 * The aspect ratios the product actually uses, so a skeleton and the content it replaces cannot
 * drift apart (D-8).
 *
 * `garment` is the consumer grid card ratio from §6.2 (3:4). `render` is the try-on result,
 * which comes back portrait from upstream.
 */
export const ASPECT_RATIOS = {
  square: 1,
  garment: 3 / 4,
  render: 3 / 4,
  portrait: 2 / 3,
  landscape: 4 / 3,
  wide: 16 / 9,
  banner: 3 / 1,
} as const;

export type AspectRatioName = keyof typeof ASPECT_RATIOS;

export interface AspectRatioProps
  extends Omit<React.ComponentPropsWithoutRef<typeof AspectRatioPrimitive.Root>, 'ratio'> {
  /** A named product ratio, or a raw number (width / height). */
  ratio?: AspectRatioName | number;
}

export function resolveRatio(ratio: AspectRatioName | number | undefined): number {
  if (typeof ratio === 'number') return ratio;
  return ASPECT_RATIOS[ratio ?? 'garment'];
}

/**
 * Reserves the box before the content arrives. Every image in the catalog grid and every render
 * viewer sits inside one of these — that is how CLS stays under 0.1 (D-8).
 */
export const AspectRatio = React.forwardRef<
  React.ComponentRef<typeof AspectRatioPrimitive.Root>,
  AspectRatioProps
>(function AspectRatio({ className, ratio, ...props }, ref) {
  return (
    <AspectRatioPrimitive.Root
      ref={ref}
      ratio={resolveRatio(ratio)}
      className={cn('overflow-hidden', className)}
      {...props}
    />
  );
});
