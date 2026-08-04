import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

/**
 * The two layout languages meet here (D-4, §6.2).
 *
 * `consumer`: --radius-xl, --shadow-sm, image first, generous padding.
 * `admin`: --radius-md, a hairline border, no shadow, no image unless the image is the data.
 *
 * Pick deliberately. A consumer card in the admin console makes a dense table look like a
 * marketing page; an admin card on the catalog makes the clothes look like rows.
 */
export const cardVariants = cva('flex flex-col bg-surface text-ink', {
  variants: {
    variant: {
      consumer: 'rounded-xl shadow-sm',
      admin: 'rounded-md border border-line',
      /* A well: forms, settings groups, anything that reads as inset rather than raised. */
      sunken: 'rounded-lg bg-surface-sunken',
      ghost: 'rounded-lg',
    },
    interactive: {
      true: [
        'text-start transition-[box-shadow,border-color,translate] duration-fast ease-out',
        'hover:shadow-md hover:-translate-y-px',
        'active:translate-y-0 active:shadow-sm',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
      ],
      false: '',
    },
    /** Draws the card as selected — the admin table's selected-row treatment. */
    selected: {
      true: 'border-brand bg-brand-tint',
      false: '',
    },
  },
  defaultVariants: { variant: 'consumer', interactive: false, selected: false },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /** Render as `<article>` for a card that is a self-contained piece of content. */
  as?: 'div' | 'article' | 'li' | 'section';
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, interactive, selected, as = 'div', ...props },
  ref,
) {
  // Cast to a single concrete tag so the ref and prop types line up. Typing this
  // as `React.ElementType` makes JSX intersect the ref types of every allowed
  // tag, which nothing can satisfy. The runtime element is still `as`.
  const Component = as as 'div';
  return (
    <Component
      ref={ref}
      className={cn(cardVariants({ variant, interactive, selected }), className)}
      {...props}
    />
  );
});

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex flex-col gap-1 p-4', className)} {...props} />;
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level. Pick the one the document outline needs, not the one that looks right (D-20). */
  as?: 'h2' | 'h3' | 'h4';
}

export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { className, as = 'h3', ...props },
  ref,
) {
  const Component = as;
  return (
    <Component
      ref={ref}
      className={cn('font-display text-xl font-semibold text-balance text-ink', className)}
      {...props}
    />
  );
});

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn('text-sm text-ink-muted', className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex-1 p-4 pt-0', className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('flex items-center gap-2 p-4 pt-0', className)} {...props} />;
}

/** Full-bleed media slot: cancels the card padding so an image reaches the rounded edge. */
export function CardMedia({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('overflow-hidden rounded-t-[inherit]', className)} {...props} />;
}
