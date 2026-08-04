import { useTranslations } from 'next-intl';

import { Skeleton } from '@repo/ui';

/**
 * Loading states — D-5, D-8.
 *
 * Never a bare spinner on a full screen. Each variant matches the aspect ratio and the block
 * layout of the content it stands in for, so the page does not jump when the real thing
 * arrives (CLS below 0.1 on catalog and result screens).
 */

export type SkeletonVariant = 'grid' | 'list' | 'detail' | 'form' | 'table' | 'prose';

export interface PageSkeletonProps {
  variant?: SkeletonVariant;
  /** Number of repeated blocks. Defaults suit the first fold at 360 px and at 1200 px. */
  count?: number;
}

/** Announced politely so a screen reader hears "loading" rather than silence (D-20). */
function Frame({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="w-full">
      <span className="sr-only">{t('loading')}</span>
      {children}
    </div>
  );
}

function GridSkeleton({ count }: { count: number }) {
  // 2 cols @360, 3 @768, 4 @1200 — the consumer catalog grid (§6.2).
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-3">
          {/* 3:4 — the catalog card image ratio, so nothing reflows on load. */}
          <Skeleton className="aspect-card w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4 rounded-sm" />
          <Skeleton className="h-4 w-1/3 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="h-20 w-16 shrink-0 rounded-lg" />
          <div className="flex w-full flex-col gap-2">
            <Skeleton className="h-4 w-2/5 rounded-sm" />
            <Skeleton className="h-3 w-1/4 rounded-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Skeleton className="aspect-card w-full rounded-xl" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-4/5 rounded-sm" />
        <Skeleton className="h-5 w-1/3 rounded-sm" />
        <Skeleton className="h-24 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-lg sm:w-56" />
      </div>
    </div>
  );
}

function FormSkeleton({ count }: { count: number }) {
  return (
    <div className="flex w-full flex-col gap-6">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24 rounded-sm" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      ))}
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}

function TableSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-px">
      <Skeleton className="h-9 w-full rounded-t-md" />
      {Array.from({ length: count }, (_, index) => (
        // 44 px — `--density-row-height` at the `comfortable` default (§6.1).
        <Skeleton key={index} className="h-11 w-full rounded-none last:rounded-b-md" />
      ))}
    </div>
  );
}

function ProseSkeleton({ count }: { count: number }) {
  return (
    <div className="flex max-w-prose flex-col gap-3">
      <Skeleton className="h-8 w-2/3 rounded-sm" />
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-4 w-full rounded-sm last:w-2/3" />
      ))}
    </div>
  );
}

const DEFAULT_COUNTS: Record<SkeletonVariant, number> = {
  grid: 8,
  list: 5,
  detail: 1,
  form: 3,
  table: 8,
  prose: 6,
};

export function PageSkeleton({ variant = 'list', count }: PageSkeletonProps) {
  const items = count ?? DEFAULT_COUNTS[variant];

  return (
    <Frame>
      {variant === 'grid' && <GridSkeleton count={items} />}
      {variant === 'list' && <ListSkeleton count={items} />}
      {variant === 'detail' && <DetailSkeleton />}
      {variant === 'form' && <FormSkeleton count={items} />}
      {variant === 'table' && <TableSkeleton count={items} />}
      {variant === 'prose' && <ProseSkeleton count={items} />}
    </Frame>
  );
}
