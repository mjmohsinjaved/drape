import Link from 'next/link';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';


import { DirectionalIcon } from '@/components/DirectionalIcon';
import { toSearchParams, type BrowseFilters } from '@/features/catalog-browse/lib/filters';

export interface BrowsePaginationProps {
  filters: BrowseFilters;
  /** The path the links point at, already locale-prefixed. */
  basePath: string;
  page: number;
  totalPages: number;
}

/**
 * Grid pagination as **links**, not buttons.
 *
 * The URL is the source of truth for browse state (§6.5), so page two is a real address: it is
 * crawlable, shareable, and works with the back button and a middle-click. That also keeps this
 * a Server Component — a paginator built on `onPageChange` would drag the whole grid into the
 * client bundle for the sake of two arrows.
 */
export function BrowsePagination({ filters, basePath, page, totalPages }: BrowsePaginationProps) {
  const t = useTranslations('browse');

  if (totalPages <= 1) return null;

  const href = (target: number): string => {
    const query = toSearchParams({ ...filters, page: target }).toString();
    return query === '' ? basePath : `${basePath}?${query}`;
  };

  const linkClass =
    'inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong px-4 text-sm hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]';
  const disabledClass =
    'inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm text-ink-subtle';

  return (
    <nav aria-label={t('pagination.label')} className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass} rel="prev">
          <DirectionalIcon>
            <ChevronLeft aria-hidden="true" className="size-4" />
          </DirectionalIcon>
          {t('pagination.previous')}
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden="true">
          {t('pagination.previous')}
        </span>
      )}

      <p className="text-sm text-ink-muted">{t('pagination.page', { page, total: totalPages })}</p>

      {page < totalPages ? (
        <Link href={href(page + 1)} className={linkClass} rel="next">
          {t('pagination.next')}
          <DirectionalIcon>
            <ChevronRight aria-hidden="true" className="size-4" />
          </DirectionalIcon>
        </Link>
      ) : (
        <span className={disabledClass} aria-hidden="true">
          {t('pagination.next')}
        </span>
      )}
    </nav>
  );
}
