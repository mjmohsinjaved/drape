'use client';

import * as React from 'react';

import * as ToolbarPrimitive from '@radix-ui/react-toolbar';

import { cn } from '../../lib/cn';

export interface ToolbarProps
  extends React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Root> {
  /** `bulk` docks the bar to the bottom of the viewport — the admin bulk-action bar (§6.2). */
  variant?: 'inline' | 'bulk';
}

/**
 * A single tab stop containing several controls, moved between with the arrow keys. That is what
 * makes an admin action bar bearable: one Tab to reach it, arrows to pick, rather than eight
 * Tabs to get past it.
 *
 * `variant="bulk"` is the bar that appears when a selection exists. It reports its own count and
 * hosts the operations; per-item progress and the success/failure summary belong to the caller
 * (D-16).
 *
 * **Both variants wrap.** `bulk` did not, and its contents have an intrinsic width of roughly
 * 700px — a count, five labelled operations, a cap warning and a clear button. At the 360px floor
 * that is not a cramped bar but one whose last controls sit outside a `sticky` element the page
 * cannot scroll sideways to reach, and D-9 requires the console to be usable on a phone for
 * exactly the approvals this bar performs. Wrapping is also why the row gap matters: `gap-2`
 * applies on both axes, so a wrapped second line keeps the same rhythm as the first.
 */
export const Toolbar = React.forwardRef<
  React.ComponentRef<typeof ToolbarPrimitive.Root>,
  ToolbarProps
>(function Toolbar({ className, variant = 'inline', ...props }, ref) {
  return (
    <ToolbarPrimitive.Root
      ref={ref}
      className={cn(
        'flex flex-wrap items-center gap-2',
        variant === 'bulk' && [
          'sticky bottom-0 z-20 rounded-lg border border-line bg-surface-raised px-4 py-3 shadow-lg',
          'transition-[opacity,translate] duration-base ease-out',
        ],
        className,
      )}
      {...props}
    />
  );
});

export const ToolbarButton = ToolbarPrimitive.Button;
export const ToolbarLink = ToolbarPrimitive.Link;
export const ToolbarToggleGroup = ToolbarPrimitive.ToggleGroup;
export const ToolbarToggleItem = ToolbarPrimitive.ToggleItem;

export const ToolbarSeparator = React.forwardRef<
  React.ComponentRef<typeof ToolbarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Separator>
>(function ToolbarSeparator({ className, ...props }, ref) {
  return (
    <ToolbarPrimitive.Separator
      ref={ref}
      className={cn('mx-1 h-6 w-px shrink-0 bg-line', className)}
      {...props}
    />
  );
});

/** Pushes everything after it to the reading-end side. Logical: `ms-auto`, never `ml-auto`. */
export function ToolbarSpacer({ className }: { className?: string }): React.JSX.Element {
  return <span aria-hidden="true" className={cn('ms-auto', className)} />;
}
