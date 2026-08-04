'use client';

import * as React from 'react';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export type DialogOverlayProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>;

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-overlay',
        'transition-opacity duration-fast ease-out',
        'data-[state=closed]:opacity-0',
        className,
      )}
      {...props}
    />
  );
});

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Hide the corner close button — for a dialog whose only exits are its own buttons. */
  hideCloseButton?: boolean;
  /** Accessible name for the close button. Translate it. */
  closeLabel?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * A modal dialog. Radix handles the focus trap, the Escape key, the scroll lock and the
 * `aria-modal` semantics; what is added here is the token styling and a close control that is a
 * real 44px target.
 *
 * Every dialog needs a `DialogTitle` — Radix warns without one, and a dialog with no accessible
 * name is announced as "dialog" and nothing else. Use `VisuallyHidden` if the design has no
 * visible heading.
 */
export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  { className, children, hideCloseButton = false, closeLabel = 'Close', size = 'md', ...props },
  ref,
) {
  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Centred by a flex wrapper rather than `left: 50%` + translate: the physical
          offset would need mirroring under RTL, and there are no [dir] overrides
          in this codebase (§6.7). The wrapper is click-through so an outside press
          still reaches the overlay. */}
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'pointer-events-auto relative flex max-h-full w-full flex-col',
            'rounded-xl border border-line bg-surface text-ink shadow-xl outline-none',
            'transition-[opacity,scale] duration-base ease-out',
            'data-[state=closed]:scale-95 data-[state=closed]:opacity-0',
            size === 'sm' && 'max-w-md',
            size === 'md' && 'max-w-lg',
            size === 'lg' && 'max-w-3xl',
            className,
          )}
          {...props}
        >
          {children}
          {hideCloseButton ? null : (
            <DialogPrimitive.Close
              className={cn(
                'absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-md',
                'text-ink-subtle transition-colors duration-fast',
                'hover:bg-surface-sunken hover:text-ink',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              )}
            >
              <X aria-hidden="true" className="size-5" />
              <VisuallyHidden>{closeLabel}</VisuallyHidden>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
});

export type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement>;

export function DialogHeader({ className, ...props }: DialogHeaderProps): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1.5 p-6 pb-4 pe-14', className)} {...props} />;
}

export type DialogBodyProps = React.HTMLAttributes<HTMLDivElement>;

/** Scrolls independently so the header and footer stay put on a short viewport. */
export function DialogBody({ className, ...props }: DialogBodyProps): React.JSX.Element {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-1', className)} {...props} />;
}

export type DialogFooterProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Actions stack full-width on a phone and sit inline from 480px. The primary action is last in
 * the DOM and last visually in both directions, because `flex-row` follows the reading order.
 */
export function DialogFooter({ className, ...props }: DialogFooterProps): React.JSX.Element {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 p-6 pt-4 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export type DialogTitleProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  DialogTitleProps
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('font-display text-xl font-semibold text-ink', className)}
      {...props}
    />
  );
});

export type DialogDescriptionProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
>;

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  DialogDescriptionProps
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-ink-muted', className)}
      {...props}
    />
  );
});
