'use client';

import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

export const inputVariants = cva(
  [
    'flex w-full min-w-0 font-body text-ink',
    'bg-surface border border-line-strong',
    'transition-[border-color,box-shadow,background-color] duration-fast ease-out',
    'placeholder:text-ink-subtle',
    'hover:border-ink-subtle',
    'focus-visible:outline-none focus-visible:border-brand focus-visible:shadow-[var(--shadow-focus)]',
    'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle disabled:hover:border-line-strong',
    'read-only:bg-surface-sunken',
    'aria-[invalid=true]:border-danger aria-[invalid=true]:hover:border-danger',
    // The number spinner is unusable at 44px and unreadable in RTL. Numbers get an explicit control.
    '[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
  ],
  {
    variants: {
      size: {
        /* 44px: the touch-target floor is the default, not the exception (D-10). */
        md: 'h-11 rounded-md px-3 text-base',
        /* Admin forms. Still 36px+, and admin is pointer-first. */
        sm: 'h-9 rounded-sm px-2.5 text-sm',
        /* Follows the admin density scale (D-4). */
        density: 'min-h-control rounded-sm px-2.5 text-density',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  /** Rendered inside the field, before the text. Decorative — give the field a real label. */
  startAdornment?: React.ReactNode;
  /** Rendered inside the field, after the text. A unit, a clear button, a character count. */
  endAdornment?: React.ReactNode;
}

/**
 * A single-line text control.
 *
 * It does not own its label, hint or error — wrap it in `FormField` so the aria wiring is
 * generated once and correctly. Padding is logical (`px-*` maps to `padding-inline`), so the
 * adornments swap sides under RTL with no extra CSS.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size, type = 'text', startAdornment, endAdornment, ...props },
  ref,
) {
  const field = (
    <input
      ref={ref}
      type={type}
      className={cn(
        inputVariants({ size }),
        startAdornment ? 'ps-9' : '',
        endAdornment ? 'pe-9' : '',
        className,
      )}
      {...props}
    />
  );

  if (!startAdornment && !endAdornment) return field;

  return (
    <div className="relative flex w-full items-center">
      {startAdornment ? (
        <span className="pointer-events-none absolute start-3 flex items-center text-ink-subtle [&_svg]:size-4">
          {startAdornment}
        </span>
      ) : null}
      {field}
      {endAdornment ? (
        <span className="absolute end-3 flex items-center text-ink-subtle [&_svg]:size-4">
          {endAdornment}
        </span>
      ) : null}
    </div>
  );
});
