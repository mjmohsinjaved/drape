import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ExternalLink } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

const linkVariants = cva(
  [
    'inline-flex items-center gap-1 rounded-xs',
    'transition-colors duration-fast ease-out',
    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
  ],
  {
    variants: {
      variant: {
        /* Underlined by default. Colour alone is not a link affordance (D-20). */
        default: 'text-brand underline underline-offset-4 hover:text-brand-hover active:text-brand-active',
        subtle:
          'text-ink-muted underline underline-offset-4 decoration-line-strong hover:text-ink hover:decoration-ink',
        /* For navigation blocks where position and grouping already read as links. */
        nav: 'text-ink-muted no-underline hover:text-ink active:text-ink',
      },
      size: {
        sm: 'text-sm',
        md: 'text-base',
        inherit: 'text-[length:inherit]',
      },
    },
    defaultVariants: { variant: 'default', size: 'inherit' },
  },
);

export interface LinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof linkVariants> {
  /** Render a `next/link` (or any element) with these styles: `<Link asChild><NextLink …/></Link>`. */
  asChild?: boolean;
  /** Opens in a new tab, adds `rel="noopener noreferrer"` and an announced "opens in a new tab". */
  external?: boolean;
  /** Text appended for screen readers on an external link. Translate it. */
  externalLabel?: string;
}

/**
 * `@repo/ui` never imports `next/link` — routing belongs to the app. Compose instead:
 * `<Link asChild><NextLink href="/catalog">Browse</NextLink></Link>`.
 */
export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    className,
    variant,
    size,
    asChild = false,
    external = false,
    externalLabel = 'opens in a new tab',
    children,
    target,
    rel,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot : 'a';

  return (
    <Component
      ref={ref}
      className={cn(linkVariants({ variant, size }), className)}
      target={external ? '_blank' : target}
      rel={external ? 'noopener noreferrer' : rel}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {external ? (
            <>
              <ExternalLink aria-hidden="true" className="size-[1em] shrink-0" />
              <VisuallyHidden>{` (${externalLabel})`}</VisuallyHidden>
            </>
          ) : null}
        </>
      )}
    </Component>
  );
});
