'use client';

import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';
import { ChevronRight } from 'lucide-react';

import { cn } from '../../lib/cn';
import { DirectionalIcon } from '../directional-icon/DirectionalIcon';

export interface BreadcrumbsProps extends React.ComponentPropsWithoutRef<'nav'> {
  /** Accessible name for the landmark. Translate it. */
  label?: string;
}

/**
 * A `<nav>` landmark wrapping an ordered list, because breadcrumbs are a path and the order is
 * the meaning.
 *
 * The separator is a `DirectionalIcon` — a breadcrumb chevron points along the reading direction
 * and therefore mirrors in `ur` (§6.7).
 */
export const Breadcrumbs = React.forwardRef<HTMLElement, BreadcrumbsProps>(function Breadcrumbs(
  { className, label = 'Breadcrumb', children, ...props },
  ref,
) {
  return (
    <nav ref={ref} aria-label={label} className={className} {...props}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">{children}</ol>
    </nav>
  );
});

export function BreadcrumbItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'li'>): React.JSX.Element {
  return <li className={cn('inline-flex items-center gap-1.5', className)} {...props} />;
}

export interface BreadcrumbLinkProps extends React.ComponentPropsWithoutRef<'a'> {
  /** Compose with the app's router: `<BreadcrumbLink asChild><NextLink …/></BreadcrumbLink>`. */
  asChild?: boolean;
}

export const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(
  function BreadcrumbLink({ className, asChild = false, ...props }, ref) {
    const Component = asChild ? Slot : 'a';
    return (
      <Component
        ref={ref}
        className={cn(
          'inline-flex min-h-11 items-center rounded-xs transition-colors duration-fast',
          'hover:text-ink hover:underline hover:underline-offset-4',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
          className,
        )}
        {...props}
      />
    );
  },
);

/** The current page. Not a link — `aria-current="page"` and no href. */
export function BreadcrumbPage({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'span'>): React.JSX.Element {
  return (
    <span
      aria-current="page"
      className={cn('inline-flex min-h-11 items-center font-medium text-ink', className)}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'li'>): React.JSX.Element {
  return (
    <li role="presentation" className={cn('text-ink-subtle', className)} {...props}>
      {children ?? (
        <DirectionalIcon>
          <ChevronRight className="size-3.5" />
        </DirectionalIcon>
      )}
    </li>
  );
}

/** Collapsed middle of a long path. Pair it with a `DropdownMenu` listing the hidden levels. */
export function BreadcrumbEllipsis({
  className,
  label = 'Show more levels',
  ...props
}: React.ComponentPropsWithoutRef<'span'> & { label?: string }): React.JSX.Element {
  return (
    <span aria-label={label} className={cn('px-1 text-ink-subtle', className)} {...props}>
      &#8230;
    </span>
  );
}
