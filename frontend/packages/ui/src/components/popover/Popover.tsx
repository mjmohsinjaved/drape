'use client';

import * as React from 'react';

import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '../../lib/cn';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>;

/**
 * `align="start"` is a logical alignment: Radix resolves it against the reading direction from
 * `<DirectionProvider>`, so a popover anchored to the start of its trigger stays anchored to the
 * start in `ur`.
 */
export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(function PopoverContent({ className, align = 'start', sideOffset = 6, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 w-72 rounded-lg border border-line bg-surface-raised p-4 text-ink shadow-lg outline-none',
          'origin-[var(--radix-popover-content-transform-origin)]',
          'transition-[opacity,scale] duration-fast ease-out',
          'data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
