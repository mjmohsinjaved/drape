'use client';

import * as React from 'react';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../../lib/cn';
import { DirectionalIcon } from '../directional-icon/DirectionalIcon';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface PaginationProps extends Omit<React.ComponentPropsWithoutRef<'nav'>, 'onChange'> {
  /** 1-based. */
  page: number;
  /** Total number of pages. When 0 or 1, the component renders nothing. */
  pageCount: number;
  onPageChange: (page: number) => void;
  /** How many numbered pages to show around the current one. */
  siblingCount?: number;
  label?: string;
  previousLabel?: string;
  nextLabel?: string;
  /** Builds each page button's accessible name: `(page) => \`Page ${page}\``. */
  pageLabel?: (page: number) => string;
  /** Live summary, e.g. "Showing 21–40 of 137 garments". Announced on change. */
  summary?: React.ReactNode;
}

const ELLIPSIS = 'ellipsis' as const;
type PageToken = number | typeof ELLIPSIS;

function pageTokens(page: number, pageCount: number, siblingCount: number): PageToken[] {
  const total = siblingCount * 2 + 5;
  if (pageCount <= total) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const start = Math.max(2, page - siblingCount);
  const end = Math.min(pageCount - 1, page + siblingCount);
  const tokens: PageToken[] = [1];

  if (start > 2) tokens.push(ELLIPSIS);
  for (let current = start; current <= end; current += 1) tokens.push(current);
  if (end < pageCount - 1) tokens.push(ELLIPSIS);
  tokens.push(pageCount);

  return tokens;
}

/**
 * Numbered pagination for admin tables. The consumer side scrolls or loads more instead —
 * pagination on a phone browsing clothes is a chore (§6.2).
 *
 * Previous/Next chevrons are `DirectionalIcon`s: they point along the reading direction and
 * mirror in `ur`. The controls themselves are ordered by the DOM, which flex already reverses.
 */
export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(function Pagination(
  {
    className,
    page,
    pageCount,
    onPageChange,
    siblingCount = 1,
    label = 'Pagination',
    previousLabel = 'Previous page',
    nextLabel = 'Next page',
    pageLabel = (value) => `Page ${String(value)}`,
    summary,
    ...props
  },
  ref,
) {
  if (pageCount <= 1) return null;

  const tokens = pageTokens(page, pageCount, siblingCount);
  const buttonBase = cn(
    'inline-flex size-11 items-center justify-center rounded-md text-sm font-medium',
    'transition-colors duration-fast ease-out',
    'hover:bg-surface-sunken',
    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
    'disabled:pointer-events-none disabled:opacity-40',
  );

  return (
    <nav
      ref={ref}
      aria-label={label}
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
      {...props}
    >
      {summary ? (
        <p className="text-sm text-ink-muted" aria-live="polite">
          {summary}
        </p>
      ) : null}

      <ul className="flex items-center gap-1">
        <li>
          <button
            type="button"
            className={cn(buttonBase, 'text-ink-muted')}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <DirectionalIcon>
              <ChevronLeft className="size-4" />
            </DirectionalIcon>
            <VisuallyHidden>{previousLabel}</VisuallyHidden>
          </button>
        </li>

        {tokens.map((token, index) =>
          token === ELLIPSIS ? (
            <li key={`ellipsis-${String(index)}`} aria-hidden="true" className="px-1 text-ink-subtle">
              &#8230;
            </li>
          ) : (
            <li key={token}>
              <button
                type="button"
                aria-label={pageLabel(token)}
                aria-current={token === page ? 'page' : undefined}
                className={cn(
                  buttonBase,
                  token === page ? 'bg-brand text-brand-fg hover:bg-brand-hover' : 'text-ink',
                )}
                onClick={() => onPageChange(token)}
              >
                {token}
              </button>
            </li>
          ),
        )}

        <li>
          <button
            type="button"
            className={cn(buttonBase, 'text-ink-muted')}
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            <DirectionalIcon>
              <ChevronRight className="size-4" />
            </DirectionalIcon>
            <VisuallyHidden>{nextLabel}</VisuallyHidden>
          </button>
        </li>
      </ul>
    </nav>
  );
});
