'use client';

import * as React from 'react';

import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Checkbox } from '../checkbox/Checkbox';
import { Skeleton } from '../skeleton/Skeleton';
import { ErrorState } from '../states/ErrorState';
import { PermissionDeniedState } from '../states/PermissionDeniedState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../table/Table';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<TRow> {
  /** Stable key. Also the sort key sent to the API. */
  id: string;
  header: React.ReactNode;
  /** Cell renderer. Keep it pure — it runs on every render of every row. */
  cell: (row: TRow) => React.ReactNode;
  sortable?: boolean;
  /** Right-align and use tabular figures. */
  numeric?: boolean;
  /** Hide below this breakpoint. The column's data must also appear somewhere else (D-9). */
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Inline size, e.g. `'8rem'`. */
  width?: string;
}

export type DataTableState = 'default' | 'loading' | 'empty' | 'error' | 'denied';

export interface DataTableProps<TRow> {
  rows: readonly TRow[];
  columns: ReadonlyArray<DataTableColumn<TRow>>;
  /** Stable identity per row. Used for keys, selection and the keyboard cursor. */
  getRowId: (row: TRow) => string;
  /**
   * Which of the D-5 states to render. `default` shows the rows. Every other value replaces the
   * body with the matching shell, so a table can never silently render zero rows and call it a
   * screen.
   */
  state?: DataTableState;
  /**
   * REQUIRED. The empty state, which must direct the user to the next action rather than report
   * emptiness (D-6). Build it with `<EmptyState>` so the action prop is enforced.
   */
  empty: React.ReactNode;
  /** Error shell. Defaults to a generic `<ErrorState>` with the supplied retry. */
  error?: React.ReactNode;
  /** Called by the default error shell's retry. */
  onRetry?: () => void;
  /** Permission-denied shell. Defaults to `<PermissionDeniedState>`. */
  denied?: React.ReactNode;
  /** Skeleton row count while loading. Match the page size so the table does not resize (D-8). */
  loadingRows?: number;
  /** Accessible name for the table. */
  caption: React.ReactNode;
  showCaption?: boolean;

  /* -- sorting -- */
  sort?: DataTableSort | null;
  onSortChange?: (sort: DataTableSort) => void;

  /* -- selection -- */
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  selectAllLabel?: string;
  selectRowLabel?: (row: TRow) => string;

  /* -- interaction -- */
  /** Enter on the focused row, or a click. */
  onRowActivate?: (row: TRow) => void;
  /**
   * `j`/`k` move the cursor, `Enter` opens (D-19). Bound to the table, not the document, so it
   * never steals a key from a search field.
   */
  keyboardNavigation?: boolean;
  className?: string;
  containerClassName?: string;
}

/**
 * The shell every admin list sits in: sorting, selection, column visibility by breakpoint,
 * sticky header, and the D-5 states wired in as first-class props rather than as something each
 * screen remembers.
 *
 * It is deliberately not a data layer. Sorting and pagination are server concerns — this
 * component reports intent and renders what it is given.
 */
export function DataTable<TRow>({
  rows,
  columns,
  getRowId,
  state = 'default',
  empty,
  error,
  onRetry,
  denied,
  loadingRows = 8,
  caption,
  showCaption = false,
  sort = null,
  onSortChange,
  selectedIds,
  onSelectionChange,
  selectAllLabel = 'Select all rows',
  selectRowLabel,
  onRowActivate,
  keyboardNavigation = false,
  className,
  containerClassName,
}: DataTableProps<TRow>): React.JSX.Element {
  const selectable = Boolean(onSelectionChange);
  const selected = React.useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const [cursor, setCursor] = React.useState(0);

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(getRowId(row)));
  const someSelected = rows.some((row) => selected.has(getRowId(row))) && !allSelected;

  const toggleAll = (): void => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : rows.map(getRowId));
  };

  const toggleRow = (id: string): void => {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange([...next]);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableSectionElement>): void => {
    if (!keyboardNavigation || rows.length === 0) return;

    // Never swallow a key the user is typing into a control inside a cell.
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((current) => Math.min(current + 1, rows.length - 1));
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && onRowActivate) {
      const row = rows[cursor];
      if (row) {
        event.preventDefault();
        onRowActivate(row);
      }
    }
  };

  const columnCount = columns.length + (selectable ? 1 : 0);

  const hideClass = (hideBelow: DataTableColumn<TRow>['hideBelow']): string => {
    if (hideBelow === 'sm') return 'hidden sm:table-cell';
    if (hideBelow === 'md') return 'hidden md:table-cell';
    if (hideBelow === 'lg') return 'hidden lg:table-cell';
    return '';
  };

  const body = ((): React.ReactNode => {
    if (state === 'loading') {
      return Array.from({ length: loadingRows }, (_, rowIndex) => (
        <TableRow key={`skeleton-${String(rowIndex)}`}>
          {selectable ? (
            <TableCell>
              <Skeleton className="size-5" />
            </TableCell>
          ) : null}
          {columns.map((column) => (
            <TableCell key={column.id} className={hideClass(column.hideBelow)}>
              <Skeleton className="h-4 w-full max-w-40" />
            </TableCell>
          ))}
        </TableRow>
      ));
    }

    if (state !== 'default') {
      const shell =
        state === 'empty'
          ? empty
          : state === 'denied'
            ? (denied ?? <PermissionDeniedState />)
            : (error ?? <ErrorState onRetry={onRetry} />);

      return (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columnCount} className="p-0">
            {shell}
          </TableCell>
        </TableRow>
      );
    }

    return rows.map((row, rowIndex) => {
      const id = getRowId(row);
      return (
        <TableRow
          key={id}
          selected={selected.has(id)}
          active={keyboardNavigation && rowIndex === cursor}
          onClick={onRowActivate ? () => onRowActivate(row) : undefined}
          className={onRowActivate ? 'cursor-pointer' : undefined}
        >
          {selectable ? (
            <TableCell className="w-10">
              <Checkbox
                checked={selected.has(id)}
                onCheckedChange={() => toggleRow(id)}
                onClick={(event) => event.stopPropagation()}
                aria-label={selectRowLabel ? selectRowLabel(row) : `Select row ${String(rowIndex + 1)}`}
              />
            </TableCell>
          ) : null}
          {columns.map((column) => (
            <TableCell
              key={column.id}
              numeric={column.numeric ?? false}
              className={hideClass(column.hideBelow)}
              style={column.width ? { inlineSize: column.width } : undefined}
            >
              {column.cell(row)}
            </TableCell>
          ))}
        </TableRow>
      );
    });
  })();

  return (
    <Table
      caption={caption}
      showCaption={showCaption}
      className={className}
      containerClassName={containerClassName}
    >
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {selectable ? (
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={toggleAll}
                aria-label={selectAllLabel}
              />
            </TableHead>
          ) : null}
          {columns.map((column) => {
            // Narrowed to a value rather than a boolean, so the direction reads below without
            // re-checking for null.
            const activeSort = sort && sort.columnId === column.id ? sort : null;
            const ariaSort = activeSort
              ? activeSort.direction === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none';

            return (
              <TableHead
                key={column.id}
                sort={column.sortable ? ariaSort : undefined}
                numeric={column.numeric ?? false}
                className={hideClass(column.hideBelow)}
                style={column.width ? { inlineSize: column.width } : undefined}
              >
                {column.sortable && onSortChange ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSortChange({
                        columnId: column.id,
                        direction: activeSort?.direction === 'asc' ? 'desc' : 'asc',
                      });
                    }}
                    className={cn(
                      'inline-flex min-h-9 items-center gap-1 rounded-xs uppercase',
                      'transition-colors duration-fast hover:text-ink',
                      'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
                      activeSort && 'text-ink',
                    )}
                  >
                    {column.header}
                    {activeSort ? (
                      activeSort.direction === 'asc' ? (
                        <ArrowUp aria-hidden="true" className="size-3" />
                      ) : (
                        <ArrowDown aria-hidden="true" className="size-3" />
                      )
                    ) : (
                      <ChevronsUpDown aria-hidden="true" className="size-3 opacity-50" />
                    )}
                    <VisuallyHidden>
                      {activeSort
                        ? activeSort.direction === 'asc'
                          ? ', sorted ascending'
                          : ', sorted descending'
                        : ', not sorted'}
                    </VisuallyHidden>
                  </button>
                ) : (
                  column.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody
        tabIndex={keyboardNavigation ? 0 : undefined}
        onKeyDown={handleKeyDown}
        className={keyboardNavigation ? 'focus-visible:outline-none' : undefined}
      >
        {body}
      </TableBody>
    </Table>
  );
}
