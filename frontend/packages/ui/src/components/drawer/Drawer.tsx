'use client';

import * as React from 'react';

import * as DialogPrimitive from '@radix-ui/react-dialog';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;
export const DrawerPortal = DialogPrimitive.Portal;

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Show the grab handle. It signals "this came from the bottom edge"; it is not a control. */
  showHandle?: boolean;
  closeLabel?: string;
}

/**
 * The mobile bottom sheet: filters, sort, the share options, the photo-source chooser.
 *
 * A drawer moves along the block axis only, which is identical in `en` and `ur` — that is why
 * this and `Sheet` are separate components rather than one with four sides. Use `Sheet` when the
 * panel belongs to an edge that mirrors.
 *
 * Height is capped so the page behind stays partly visible: a sheet that fills the viewport
 * should be a route, not a sheet.
 */
export const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent(
  { className, children, showHandle = true, closeLabel = 'Close', ...props },
  ref,
) {
  return (
    <DrawerPortal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-overlay transition-opacity duration-base ease-out',
          'data-[state=closed]:opacity-0',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col',
          'rounded-t-xl border-t border-line bg-surface text-ink shadow-xl outline-none',
          'transition-transform duration-base ease-out data-[state=closed]:translate-y-full',
          // Room for the home indicator on iOS and the gesture bar on Android.
          'pb-[env(safe-area-inset-bottom)]',
          className,
        )}
        {...props}
      >
        {showHandle ? (
          <div aria-hidden="true" className="flex justify-center pt-3 pb-1">
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
        ) : null}
        {children}
        <DialogPrimitive.Close className="sr-only">
          <VisuallyHidden>{closeLabel}</VisuallyHidden>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DrawerPortal>
  );
});

export function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1 px-5 pt-2 pb-4', className)} {...props} />;
}

export function DrawerBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-5', className)} {...props} />;
}

export function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-2 px-5 pt-4 pb-5', className)} {...props} />;
}

export const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('font-display text-lg font-semibold text-ink', className)}
      {...props}
    />
  );
});

export const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-ink-muted', className)}
      {...props}
    />
  );
});
