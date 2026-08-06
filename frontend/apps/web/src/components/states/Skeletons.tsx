import { useTranslations } from 'next-intl';

import { Skeleton } from '@repo/ui';

/**
 * Loading states — D-5, D-8.
 *
 * Never a bare spinner on a full screen. Each variant matches the aspect ratio and the block
 * layout of the content it stands in for, so the page does not jump when the real thing
 * arrives (CLS below 0.1 on catalog and result screens).
 */

export type SkeletonVariant = 'grid' | 'list' | 'detail' | 'form' | 'table' | 'prose' | 'cards';

/**
 * What sits above the body.
 *
 * Almost every screen in this app opens with `<header>` = an `<h1>` plus a `max-w-prose` lead
 * paragraph, and no variant drew it — so every route pushed its content down 80–120 px the
 * moment the real page landed. That was the single largest contributor to cumulative layout
 * shift in the app, and it was invisible from any one segment because it was in all of them.
 *
 * `stats` is the admin equivalent: a row of tiles above a table (catalog health, and the
 * analytics and usage screens when they land).
 */
export type SkeletonLead = 'header' | 'stats';

export interface PageSkeletonProps {
  variant?: SkeletonVariant;
  /** Number of repeated blocks. Defaults suit the first fold at 360 px and at 1200 px. */
  count?: number;
  /** The block above the body. See {@link SkeletonLead} — omit it only if the page has none. */
  lead?: SkeletonLead;
  /**
   * For `grid`: the widest column count. The consumer catalog goes to four; the photo library
   * stops at three (`PhotoList`), and a skeleton that went to four there reflowed the page at
   * 1280 px for everyone with a desktop.
   */
  columns?: 3 | 4;
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

/**
 * The page header every screen opens with: an `<h1>` and a lead paragraph capped at `max-w-prose`.
 *
 * `h-9` is the rendered height of the `text-2xl`/`text-3xl` headings these screens use, so the
 * body below starts where it is going to stay.
 */
function HeaderSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <Skeleton className="h-9 w-2/5 rounded-sm" />
      <Skeleton className="h-5 w-full max-w-prose rounded-sm" />
    </div>
  );
}

/** A row of tiles above a table — the admin summary strip (`grid gap-3 sm:grid-cols-2 xl:grid-cols-4`). */
function StatsSkeleton() {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}

function GridSkeleton({ count, columns }: { count: number; columns: 3 | 4 }) {
  // 2 cols @360, 3 @768, 4 @1200 — the consumer catalog grid (§6.2). The photo library stops
  // at three, so the widest step is a prop rather than a constant.
  return (
    <div
      className={
        columns === 4
          ? 'grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 xl:grid-cols-4'
          : 'grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6'
      }
    >
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

/**
 * Squat link cards, three across — the dashboard's landing tiles (icon, title, one line).
 *
 * These pages carry no imagery at all, which is why `list` was wrong for them: it led every row
 * with an 80 × 64 thumbnail placeholder for a photo that does not exist.
 */
function CardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-xl border border-line p-5">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-5 w-1/2 rounded-sm" />
          <Skeleton className="h-4 w-4/5 rounded-sm" />
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
  // `mx-auto`, because every prose screen in the app is `mx-auto … max-w-prose` — the consent
  // page and the try-on wait among them. Without it the skeleton sat hard against the
  // reading-start edge and the content jumped sideways when it landed: a horizontal shift on
  // exactly the two routes whose fallbacks claimed to be aspect-matched.
  return (
    <div className="mx-auto flex w-full max-w-prose flex-col gap-3">
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
  cards: 3,
};

export function PageSkeleton({
  variant = 'list',
  count,
  lead,
  columns = 4,
}: PageSkeletonProps) {
  const items = count ?? DEFAULT_COUNTS[variant];

  return (
    <Frame>
      {lead === 'header' && <HeaderSkeleton />}
      {lead === 'stats' && <StatsSkeleton />}
      {variant === 'grid' && <GridSkeleton count={items} columns={columns} />}
      {variant === 'list' && <ListSkeleton count={items} />}
      {variant === 'cards' && <CardsSkeleton count={items} />}
      {variant === 'detail' && <DetailSkeleton />}
      {variant === 'form' && <FormSkeleton count={items} />}
      {variant === 'table' && <TableSkeleton count={items} />}
      {variant === 'prose' && <ProseSkeleton count={items} />}
    </Frame>
  );
}

/**
 * The authentication screens' fallback.
 *
 * `(auth)/layout.tsx` supplies no chrome — every auth *page* renders `AuthShell` itself. So a
 * bare `<PageSkeleton variant="form"/>` painted edge to edge, flush to the top-start corner, and
 * the real form then snapped into a centred 448 px card below a 64 px header. It was the worst
 * container mismatch in the app and it affected all ten auth routes.
 *
 * This reproduces `AuthShell`'s geometry exactly: header height, `main`'s alignment and padding,
 * and the card's `max-w-md`.
 */
export function AuthPageSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <div className="h-16" aria-hidden="true" />
      <div className="flex flex-1 items-start justify-center px-5 pb-16 pt-4 md:items-center md:pt-0">
        <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6">
          <Frame>
            <div className="mb-6 flex flex-col gap-2">
              <Skeleton className="h-8 w-3/5 rounded-sm" />
              <Skeleton className="h-4 w-full rounded-sm" />
            </div>
            <FormSkeleton count={fields} />
          </Frame>
        </div>
      </div>
    </div>
  );
}
