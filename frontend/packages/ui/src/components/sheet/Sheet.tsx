'use client';

import * as React from 'react';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

/**
 * Sides are logical. `start` and `end` follow the reading direction, so the admin filter panel
 * opens from the right in `en` and from the left in `ur` without a single conditional.
 *
 * `top`/`bottom` are block-direction and identical in both locales.
 */
export type SheetSide = 'start' | 'end' | 'top' | 'bottom';

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: SheetSide;
  closeLabel?: string;
  hideCloseButton?: boolean;
}

const sideClasses: Record<SheetSide, string> = {
  start: 'inset-y-0 start-0 h-full w-full max-w-sm border-e',
  end: 'inset-y-0 end-0 h-full w-full max-w-sm border-s',
  top: 'inset-x-0 top-0 max-h-[80dvh] w-full border-b',
  bottom: 'inset-x-0 bottom-0 max-h-[80dvh] w-full border-t',
};

/**
 * A panel anchored to an edge: the admin filter drawer, the mobile navigation, a detail pane.
 *
 * Modal by default — it traps focus and locks scroll. For a non-blocking panel that the user
 * keeps open while working, build a layout region instead; a sheet that does not trap focus is
 * a keyboard trap of a different kind.
 */
export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  { className, children, side = 'end', closeLabel = 'Close', hideCloseButton = false, ...props },
  ref,
) {
  return (
    <SheetPortal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-overlay transition-opacity duration-base ease-out',
          'data-[state=closed]:opacity-0',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col gap-4 bg-surface p-6 text-ink shadow-xl outline-none',
          /* Opacity only. A slide would need a mirrored transform under RTL, and
             transforms have no logical form — so the panel fades rather than
             acquiring the codebase's first [dir] override (§6.7). */
          'transition-opacity duration-base ease-out data-[state=closed]:opacity-0',
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {hideCloseButton ? null : (
          <DialogPrimitive.Close
            className={cn(
              'absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-md',
              'text-ink-subtle transition-colors duration-fast hover:bg-surface-sunken hover:text-ink',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
            )}
          >
            <X aria-hidden="true" className="size-5" />
            <VisuallyHidden>{closeLabel}</VisuallyHidden>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});

export function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1.5 pe-12', className)} {...props} />;
}

export function SheetBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)} {...props} />;
}

export function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('font-display text-xl font-semibold text-ink', className)}
      {...props}
    />
  );
});

export const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-ink-muted', className)}
      {...props}
    />
  );
});
