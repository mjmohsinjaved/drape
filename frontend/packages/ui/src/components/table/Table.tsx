import * as React from 'react';

import { cn } from '../../lib/cn';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /**
   * Density-aware by default (D-4, D-16): row height, cell padding and font size come from the
   * `--density-*` scale, which the admin shell sets with `data-density`.
   *
   * `fixed` opts out for a table whose geometry the caller controls.
   */
  density?: 'scale' | 'fixed';
  /** Accessible caption. Visually hidden by default — a table with no name is a wall of cells. */
  caption?: React.ReactNode;
  /** Show the caption. */
  showCaption?: boolean;
  /** Wrapper className, for the scroll container rather than the table. */
  containerClassName?: string;
}

/**
 * The admin console's primary surface (§6.2). Consumer history and shortlist are card lists, not
 * tables — do not reach for this on the consumer side.
 *
 * Sticky header, zebra off, hover `--color-surface-sunken`, selected `--color-brand-tint`, all
 * from §6.2. Below 768px the caller collapses rows into stacked cards; this component keeps a
 * horizontal scroll container so a wide table degrades to scrolling rather than to overflow.
 */
export const Table = React.forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, containerClassName, density = 'scale', caption, showCaption = false, children, ...props },
  ref,
) {
  return (
    <div className={cn('relative w-full overflow-x-auto', containerClassName)}>
      <table
        ref={ref}
        data-density-mode={density}
        className={cn(
          'w-full caption-bottom border-collapse text-start',
          density === 'scale' ? 'text-density' : 'text-sm',
          className,
        )}
        {...props}
      >
        {caption ? (
          <caption
            className={cn(
              'text-start text-xs text-ink-muted',
              showCaption ? 'pb-2' : 'absolute size-px overflow-hidden [clip-path:inset(50%)]',
            )}
          >
            {caption}
          </caption>
        ) : null}
        {children}
      </table>
    </div>
  );
});

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableHeader({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      className={cn('sticky top-0 z-10 bg-surface-raised [&_tr]:border-b [&_tr]:border-line', className)}
      {...props}
    />
  );
});

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableBody({ className, ...props }, ref) {
  return <tbody ref={ref} className={cn('bg-surface', className)} {...props} />;
});

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      className={cn('border-t border-line bg-surface-raised font-medium', className)}
      {...props}
    />
  );
});

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Selected row: `--color-brand-tint` (§6.2). */
  selected?: boolean;
  /** The row the keyboard is on — `j`/`k` navigation in the admin console (D-19). */
  active?: boolean;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { className, selected, active, ...props },
  ref,
) {
  return (
    <tr
      ref={ref}
      data-selected={selected || undefined}
      data-active={active || undefined}
      aria-selected={selected}
      className={cn(
        'border-b border-line transition-colors duration-fast',
        'hover:bg-surface-sunken',
        'data-[selected]:bg-brand-tint',
        // Visible focus for the j/k cursor, not only for Tab.
        'data-[active]:shadow-[inset_2px_0_0_0_var(--color-brand)]',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        className,
      )}
      {...props}
    />
  );
});

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Current sort state. Sets `aria-sort` so the direction is announced, not just drawn. */
  sort?: 'ascending' | 'descending' | 'none';
  /** Right-aligned numerics: use `numeric` rather than `text-end`, so RTL keeps digits together. */
  numeric?: boolean;
}

export const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(function TableHead(
  { className, sort, numeric, ...props },
  ref,
) {
  return (
    <th
      ref={ref}
      scope="col"
      aria-sort={sort === 'none' ? 'none' : sort}
      className={cn(
        'h-row p-cell text-start align-middle',
        'text-2xs font-semibold tracking-[0.04em] text-ink-muted uppercase whitespace-nowrap',
        numeric && 'text-end tabular-nums',
        className,
      )}
      {...props}
    />
  );
});

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { className, numeric, ...props },
  ref,
) {
  return (
    <td
      ref={ref}
      className={cn(
        'h-row p-cell align-middle text-ink',
        numeric && 'text-end tabular-nums',
        className,
      )}
      {...props}
    />
  );
});

/** Row header — the cell that names the row, e.g. the garment name. */
export const TableRowHeader = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(function TableRowHeader({ className, ...props }, ref) {
  return (
    <th
      ref={ref}
      scope="row"
      className={cn('h-row p-cell text-start align-middle font-medium text-ink', className)}
      {...props}
    />
  );
});
