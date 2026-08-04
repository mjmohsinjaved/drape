import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

/* ================================================================== *
 * Stack
 * ================================================================== */

const stackVariants = cva('flex', {
  variants: {
    direction: {
      /* `row` follows the reading direction: it becomes right-to-left in `ur`
         with no override, which is the whole reason layout is expressed in flex
         and grid rather than in offsets (§6.7). */
      row: 'flex-row',
      column: 'flex-col',
    },
    gap: {
      0: 'gap-0',
      1: 'gap-1',
      2: 'gap-2',
      3: 'gap-3',
      4: 'gap-4',
      5: 'gap-5',
      6: 'gap-6',
      8: 'gap-8',
      10: 'gap-10',
      12: 'gap-12',
      16: 'gap-16',
      /* Follows the admin density scale (D-4). */
      stack: 'gap-stack',
      section: 'gap-section',
    },
    align: {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
      baseline: 'items-baseline',
    },
    justify: {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      between: 'justify-between',
    },
    wrap: {
      true: 'flex-wrap',
      false: 'flex-nowrap',
    },
  },
  defaultVariants: { direction: 'column', gap: 4, align: 'stretch', wrap: false },
});

export interface StackProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof stackVariants> {
  as?: 'div' | 'section' | 'ul' | 'ol' | 'li' | 'nav' | 'header' | 'footer' | 'main';
}

/**
 * One-dimensional layout. Gaps come from the spacing scale; there is no `space-x-*` anywhere in
 * Drape because `space-x` is physical and does not mirror (§6.7).
 */
export const Stack = React.forwardRef<HTMLDivElement, StackProps>(function Stack(
  { className, direction, gap, align, justify, wrap, as = 'div', ...props },
  ref,
) {
  // Cast to a single concrete tag so the ref and prop types line up; typing this
  // as `React.ElementType` makes JSX intersect the ref types of every allowed tag.
  const Component = as as 'div';
  return (
    <Component
      ref={ref}
      className={cn(stackVariants({ direction, gap, align, justify, wrap }), className)}
      {...props}
    />
  );
});

/* ================================================================== *
 * Grid
 * ================================================================== */

const gridVariants = cva('grid', {
  variants: {
    cols: {
      1: 'grid-cols-1',
      2: 'grid-cols-2',
      3: 'grid-cols-3',
      4: 'grid-cols-4',
      6: 'grid-cols-6',
      12: 'grid-cols-12',
      /* The consumer catalog grid, verbatim from §6.2:
         2 cols @360, 2 @480, 3 @768, 4 @1200. */
      catalog: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
      /* The admin 12-column grid. */
      admin: 'grid-cols-12',
    },
    gap: {
      2: 'gap-2',
      3: 'gap-3',
      4: 'gap-4',
      6: 'gap-6',
      8: 'gap-8',
      /* Consumer grid gap: --space-4 growing to --space-6 (§6.2). */
      catalog: 'gap-4 md:gap-6',
      stack: 'gap-stack',
    },
  },
  defaultVariants: { cols: 'catalog', gap: 'catalog' },
});

export interface GridProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof gridVariants> {
  as?: 'div' | 'ul' | 'ol' | 'section';
}

/** Two-dimensional layout. Grid flows along the reading direction, so it mirrors for free. */
export const Grid = React.forwardRef<HTMLDivElement, GridProps>(function Grid(
  { className, cols, gap, as = 'div', ...props },
  ref,
) {
  // Cast to a single concrete tag so the ref and prop types line up; typing this
  // as `React.ElementType` makes JSX intersect the ref types of every allowed tag.
  const Component = as as 'div';
  return <Component ref={ref} className={cn(gridVariants({ cols, gap }), className)} {...props} />;
});

/* ================================================================== *
 * Container
 * ================================================================== */

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `consumer`: 1200px, centred, gutters that grow with the viewport.
   * `admin`: 1680px, full-bleed inside the shell, fixed --space-4 gutters.
   * `prose`: a comfortable measure for consent copy and policy text.
   */
  width?: 'consumer' | 'admin' | 'prose' | 'full';
  as?: 'div' | 'main' | 'section' | 'article' | 'header' | 'footer';
}

/** The two layout languages' outer boxes (D-4, §6.2). */
export const Container = React.forwardRef<HTMLDivElement, ContainerProps>(function Container(
  { className, width = 'consumer', as = 'div', ...props },
  ref,
) {
  // Cast to a single concrete tag so the ref and prop types line up; typing this
  // as `React.ElementType` makes JSX intersect the ref types of every allowed tag.
  const Component = as as 'div';
  return (
    <Component
      ref={ref}
      className={cn(
        'w-full',
        width === 'consumer' && 'mx-auto max-w-consumer gutter-consumer',
        width === 'admin' && 'max-w-admin gutter-admin',
        width === 'prose' && 'mx-auto max-w-prose gutter-consumer',
        width === 'full' && '',
        className,
      )}
      {...props}
    />
  );
});
