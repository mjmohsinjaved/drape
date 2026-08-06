import { Skeleton } from '@repo/ui';

import { PageSkeleton } from '@/components/states';

/**
 * The landing fallback — D-5, D-8.
 *
 * It used to be `<PageSkeleton variant="grid"/>`: eight catalog tiles at `md:grid-cols-3`, and
 * nothing else. The page is three blocks and the grid is the last of them — a hero (heading,
 * lead, two large buttons, the shortlisting note), a category rail inside a `<Card>`, then
 * exactly **four** new arrivals at `grid-cols-2 md:grid-cols-4`. So the old fallback drew twice
 * the tiles the page has, at a breakpoint the page does not use, in place of a hero that is the
 * LCP element on this route (§9.1). Everything moved when the real page landed.
 *
 * The wrapper reproduces `PublicShell`'s `main` — same container, same gutters — because the
 * page renders its own shell and this fallback replaces the lot.
 */
export default function LocaleLoading() {
  return (
    <div className="mx-auto w-full max-w-consumer px-5 pb-16 pt-6 md:px-8 md:pt-10 xl:px-12">
      <div className="flex flex-col gap-8 py-6 md:py-12">
        {/* The hero: a `text-3xl md:text-4xl` heading, a `text-lg` lead, two `size="lg"` buttons. */}
        <div className="flex max-w-prose flex-col gap-5" aria-hidden="true">
          <Skeleton className="h-10 w-4/5 rounded-sm" />
          <Skeleton className="h-6 w-full rounded-sm" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Skeleton className="h-12 w-full rounded-lg sm:w-48" />
            <Skeleton className="h-12 w-full rounded-lg sm:w-48" />
          </div>
          <Skeleton className="h-4 w-3/5 rounded-sm" />
        </div>

        {/* The A-6 category rail: a card of stacked rows, each at the 44 px touch floor (D-10). */}
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-7 w-40 rounded-sm" />
          <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface px-3 py-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        </div>

        {/* New arrivals — four, which is what the page asks the API for. */}
        <div className="flex flex-col gap-4">
          <Skeleton aria-hidden="true" className="h-7 w-40 rounded-sm" />
          <PageSkeleton variant="grid" count={4} />
        </div>
      </div>
    </div>
  );
}
