'use client';

import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';
import { Spinner } from '../spinner/Spinner';

/**
 * Variants and sizes are fixed by ARCHITECTURE §6.3:
 * `primary | secondary | ghost | outline | danger | link` and `sm | md | lg | icon`.
 *
 * Every variant declares hover, active, focus-visible and disabled (D-10). The focus ring is
 * `--shadow-focus`, drawn with a canvas-coloured inner ring so it reads on a brand fill as well
 * as on a card. Nothing here removes it.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2',
    'font-body font-semibold whitespace-nowrap',
    'select-none',
    'transition-[background-color,border-color,color,box-shadow,translate] duration-fast ease-out',
    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
    'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
    // Icons inherit the label's colour and never grow with it.
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-brand text-brand-fg',
          'hover:bg-brand-hover',
          'active:bg-brand-active active:translate-y-px',
        ],
        secondary: [
          'bg-surface text-ink border border-line-strong shadow-xs',
          'hover:bg-surface-sunken',
          'active:bg-surface-sunken active:translate-y-px',
        ],
        ghost: ['bg-transparent text-ink', 'hover:bg-surface-sunken', 'active:bg-surface-sunken'],
        outline: [
          'bg-transparent text-brand border border-brand',
          'hover:bg-brand-tint',
          'active:bg-brand-tint active:translate-y-px',
        ],
        danger: [
          'bg-danger text-brand-fg',
          'hover:brightness-110',
          'active:brightness-95 active:translate-y-px',
        ],
        link: [
          'bg-transparent text-brand underline underline-offset-4 decoration-from-font',
          'hover:text-brand-hover',
          'active:text-brand-active',
        ],
      },
      size: {
        /* 36px tall. Below the 44px floor, so the hit area is extended with a
           centred pseudo-element (D-10) — the control looks compact and still
           takes a thumb. */
        sm: 'h-9 rounded-md px-3 text-sm touch-target-pseudo',
        md: 'h-11 rounded-md px-4 text-sm',
        lg: 'h-12 rounded-lg px-6 text-base',
        icon: 'h-11 w-11 rounded-md p-0',
      },
      /** One primary action per screen, full-width on mobile (§6.2). */
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      // A link has no box, so box padding and height only misalign it with its text.
      { variant: 'link', size: 'sm', class: 'h-auto px-0 py-1' },
      { variant: 'link', size: 'md', class: 'h-auto px-0 py-1' },
      { variant: 'link', size: 'lg', class: 'h-auto px-0 py-1' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a <button>, keeping the styles. Use for a link that looks like a button. */
  asChild?: boolean;
  /**
   * Swaps the leading content for a spinner and disables the control. The label stays in place so
   * the button does not resize and the user keeps reading the same word (D-13).
   */
  loading?: boolean;
  /** Announced while `loading`. Name the action in progress, e.g. "Saving". */
  loadingLabel?: string;
  /** Leading icon. Mirrors under RTL only if it is a `<DirectionalIcon>`. */
  startIcon?: React.ReactNode;
  /** Trailing icon. */
  endIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    fullWidth,
    asChild = false,
    loading = false,
    loadingLabel,
    startIcon,
    endIcon,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : 'button';

  return (
    <Component
      ref={ref}
      // An unset `type` inside a form submits it. That has caused enough accidental submits.
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-disabled={disabled || loading ? true : undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {/* Slot accepts exactly one child, so an `asChild` button composes its own
          content — the caller owns the icons in that case. */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner size="sm" label={loadingLabel} /> : startIcon}
          {children}
          {loading ? null : endIcon}
        </>
      )}
    </Component>
  );
});
