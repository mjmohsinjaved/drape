'use client';

import * as React from 'react';

import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '../../lib/cn';

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: 'underline' | 'pill';
  /** Let the list scroll horizontally rather than wrap. Use for a long admin filter row. */
  scrollable?: boolean;
}

/**
 * Radix moves focus with the arrow keys and reads direction from `<DirectionProvider>`, so
 * Left/Right follow the visual order in `ur` as users of RTL interfaces expect.
 */
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  TabsListProps
>(function TabsList({ className, variant = 'underline', scrollable = false, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'flex items-center',
        variant === 'underline' && 'gap-1 border-b border-line',
        variant === 'pill' && 'gap-1 rounded-lg bg-surface-sunken p-1',
        scrollable && 'overflow-x-auto',
        className,
      )}
      data-variant={variant}
      {...props}
    />
  );
});

export type TabsTriggerProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>;

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-3 py-2',
        'font-body text-sm font-medium whitespace-nowrap text-ink-muted',
        'transition-[color,background-color,border-color] duration-fast ease-out',
        'hover:text-ink',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        'disabled:pointer-events-none disabled:opacity-50',
        // Underline variant: a 2px rule under the active tab, drawn on the block edge.
        'group-data-[variant=underline]:rounded-none',
        '[[data-variant=underline]_&]:-mb-px [[data-variant=underline]_&]:border-b-2 [[data-variant=underline]_&]:border-transparent',
        '[[data-variant=underline]_&][data-state=active]:border-brand [[data-variant=underline]_&][data-state=active]:text-brand',
        // Pill variant.
        '[[data-variant=pill]_&]:rounded-md',
        '[[data-variant=pill]_&][data-state=active]:bg-surface [[data-variant=pill]_&][data-state=active]:text-ink [[data-variant=pill]_&][data-state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  );
});

export type TabsContentProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  TabsContentProps
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-4 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]', className)}
      {...props}
    />
  );
});
