'use client';

import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';
import { Spinner } from '../spinner/Spinner';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

const iconButtonVariants = cva(
  [
    'relative inline-flex items-center justify-center',
    'transition-[background-color,border-color,color,box-shadow] duration-fast ease-out',
    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
    'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-fg hover:bg-brand-hover active:bg-brand-active',
        secondary:
          'bg-surface text-ink border border-line-strong hover:bg-surface-sunken active:bg-surface-sunken',
        ghost: 'bg-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink',
        outline: 'bg-transparent text-brand border border-brand hover:bg-brand-tint',
        danger: 'bg-transparent text-danger hover:bg-danger-tint',
      },
      size: {
        /* Admin console. Visually smaller than 44px, but the hit area is padded
           out to 44 x 44 by the pseudo-element, so the same markup is usable on
           a phone (D-10). */
        sm: 'size-8 rounded-sm [&_svg]:size-4 touch-target-pseudo',
        md: 'size-11 rounded-md [&_svg]:size-5',
        lg: 'size-12 rounded-lg [&_svg]:size-6',
        /* Follows --density-control-height (D-4). */
        density: 'h-control aspect-square rounded-sm [&_svg]:size-4 touch-target-pseudo',
      },
      shape: {
        square: '',
        round: 'rounded-full',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md', shape: 'square' },
  },
);

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>,
    VariantProps<typeof iconButtonVariants> {
  /**
   * Required. An icon is not a name. Say what the control does — "Remove from shortlist", not
   * "Trash icon" (D-13, D-20).
   */
  label: string;
  /** The icon. Rendered `aria-hidden`; `label` carries the meaning. */
  icon: React.ReactNode;
  loading?: boolean;
}

/**
 * A button whose entire content is an icon.
 *
 * There is no `asChild`: the component owns its only child, so there would be nothing for a slot
 * to replace. For an icon-only link, use `<Link>` with an `aria-label` and a `VisuallyHidden`
 * label of your own.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, shape, label, icon, loading = false, disabled, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(iconButtonVariants({ variant, size, shape }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <span aria-hidden="true" className="contents">
        {loading ? <Spinner size="sm" label={null} /> : icon}
      </span>
      {/* The accessible name lives in real text, so voice control can address it by name. */}
      <VisuallyHidden>{label}</VisuallyHidden>
    </button>
  );
});
