'use client';

import * as React from 'react';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

import { cn } from '../../lib/cn';

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export type AlertDialogOverlayProps = React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Overlay
>;

export const AlertDialogOverlay = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Overlay>,
  AlertDialogOverlayProps
>(function AlertDialogOverlay({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-overlay transition-opacity duration-fast ease-out',
        'data-[state=closed]:opacity-0',
        className,
      )}
      {...props}
    />
  );
});

export type AlertDialogContentProps = React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
>;

/**
 * An alert dialog interrupts. It has no close button and no outside-press dismissal, because the
 * only ways out are the two named choices — which is exactly the behaviour a destructive
 * confirmation needs (D-17).
 *
 * If the user can reasonably ignore it, it is a `Dialog`, a `Callout` or a toast, not this.
 */
export const AlertDialogContent = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(function AlertDialogContent({ className, ...props }, ref) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <AlertDialogPrimitive.Content
          ref={ref}
          className={cn(
            'pointer-events-auto relative flex max-h-full w-full max-w-md flex-col gap-4',
            'rounded-xl border border-line bg-surface p-6 text-ink shadow-xl outline-none',
            'transition-[opacity,scale] duration-base ease-out',
            'data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
            className,
          )}
          {...props}
        />
      </div>
    </AlertDialogPortal>
  );
});

export type AlertDialogHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export function AlertDialogHeader({
  className,
  ...props
}: AlertDialogHeaderProps): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1.5', className)} {...props} />;
}

export type AlertDialogFooterProps = React.HTMLAttributes<HTMLDivElement>;

export function AlertDialogFooter({
  className,
  ...props
}: AlertDialogFooterProps): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export type AlertDialogTitleProps = React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Title
>;

export const AlertDialogTitle = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Title>,
  AlertDialogTitleProps
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title
      ref={ref}
      className={cn('font-display text-xl font-semibold text-ink', className)}
      {...props}
    />
  );
});

export type AlertDialogDescriptionProps = React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Description
>;

export const AlertDialogDescription = React.forwardRef<
  React.ComponentRef<typeof AlertDialogPrimitive.Description>,
  AlertDialogDescriptionProps
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-ink-muted', className)}
      {...props}
    />
  );
});

export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
