import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

export const badgeVariants = cva(
  [
    'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-body font-semibold',
    '[&_svg]:size-3 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        neutral: 'bg-surface-sunken text-ink-muted',
        brand: 'bg-brand-tint text-brand',
        /* --color-gold is 3.6:1 and non-text only, so gold text always uses
           --color-gold-text (§6.1). */
        gold: 'bg-gold-tint text-gold-text',
        success: 'bg-success-tint text-success',
        warning: 'bg-warning-tint text-warning',
        danger: 'bg-danger-tint text-danger',
        info: 'bg-info-tint text-info',
        outline: 'border border-line-strong text-ink-muted',
      },
      size: {
        /* --text-2xs is admin only and never carries anything a consumer must read (§6.1). */
        sm: 'px-2 py-0.5 text-2xs tracking-[0.04em]',
        md: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

/**
 * A static label: a count, a category, a tag. It is not a control — if it can be clicked or
 * dismissed it is a `Button` or a `TagInput` chip, not a `Badge`.
 *
 * For lifecycle state (draft/published/pending) use `StatusPill`, which carries a shape and an
 * accessible name as well as a colour.
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'span';
  return (
    <Component ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
});
