'use client';

import * as React from 'react';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '../../lib/cn';

/**
 * Mount once, near the root, above `DirectionProvider`'s children.
 * `delayDuration` is short enough to feel responsive in an admin table and long enough not to
 * fire while a cursor crosses the screen.
 */
export function TooltipProvider({
  delayDuration = 300,
  skipDelayDuration = 200,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>): React.JSX.Element {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    >
      {children}
    </TooltipPrimitive.Provider>
  );
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>;

/**
 * A tooltip is a hint, never the only place information lives — it does not exist for touch
 * users and it does not survive a screen magnifier. Anything required goes in the label, the
 * hint line, or the copy itself (D-20).
 */
export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs text-canvas shadow-md',
          'origin-[var(--radix-tooltip-content-transform-origin)]',
          'transition-[opacity,scale] duration-fast ease-out',
          'data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

export interface SimpleTooltipProps {
  /** The hint text. */
  content: React.ReactNode;
  /** The trigger. Must be focusable, or keyboard users never see the hint. */
  children: React.ReactNode;
  side?: TooltipContentProps['side'];
  /** Extra delay for this tooltip only. */
  delayDuration?: number;
}

/** The common case in one element. */
export function SimpleTooltip({
  content,
  children,
  side = 'top',
  delayDuration,
}: SimpleTooltipProps): React.JSX.Element {
  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
