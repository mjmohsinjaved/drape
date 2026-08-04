import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

const spinnerVariants = cva('inline-block shrink-0 animate-spin rounded-full border-current', {
  variants: {
    size: {
      xs: 'size-3 border-2',
      sm: 'size-4 border-2',
      md: 'size-5 border-2',
      lg: 'size-8 border-[3px]',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface SpinnerProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof spinnerVariants> {
  /**
   * Announced to screen readers. Name what is happening, not the widget:
   * "Loading your try-ons", not "Loading spinner".
   *
   * Pass `null` when a visible label already says it — two announcements are worse than one.
   */
  label?: string | null | undefined;
}

/**
 * A bare spinner is never a full-screen loading state — use `<LoadingState>` with skeletons that
 * match the content's aspect ratio (D-5, D-8). This is for inline work: a button mid-save, a
 * table refreshing, a file uploading.
 *
 * Under `prefers-reduced-motion` globals.css clamps the animation to 1ms, so it renders as a
 * static ring rather than a strobing one (D-11).
 */
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { className, size, label = 'Loading', ...props },
  ref,
) {
  return (
    <span ref={ref} role="status" className={cn('inline-flex items-center', className)} {...props}>
      <span
        aria-hidden="true"
        className={cn(spinnerVariants({ size }), 'border-b-transparent border-s-transparent')}
      />
      {label ? <VisuallyHidden>{label}</VisuallyHidden> : null}
    </span>
  );
});
