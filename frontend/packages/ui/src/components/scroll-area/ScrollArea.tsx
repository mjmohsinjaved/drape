'use client';

import * as React from 'react';

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from '../../lib/cn';

export interface ScrollAreaProps
  extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  /** Which axis gets a bar. `both` for a wide admin table inside a panel. */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Props forwarded to the scrolling viewport — put `tabIndex={0}` here if the region must be keyboard-scrollable. */
  viewportProps?: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Viewport>;
}

/**
 * A styled scroll container that keeps its scrollbar visible on hover and on scroll.
 *
 * It never hides the bar entirely: a scroll region with no visible affordance strands
 * low-vision and pointer users. Radix handles RTL placement from `<DirectionProvider>`, so
 * there is no side-specific CSS here.
 */
export const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(function ScrollArea(
  { className, children, orientation = 'vertical', viewportProps, ...props },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...viewportProps}
        className={cn('size-full rounded-[inherit]', viewportProps?.className)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== 'vertical' ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});

export type ScrollBarProps = React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.ScrollAreaScrollbar
>;

export const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ScrollBarProps
>(function ScrollBar({ className, orientation = 'vertical', ...props }, ref) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none p-0.5 transition-colors duration-fast select-none',
        orientation === 'vertical' && 'h-full w-2.5 border-s border-s-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-line-strong" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});
