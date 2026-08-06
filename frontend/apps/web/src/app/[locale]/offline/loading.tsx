import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Same shape as `no-access`: an `EmptyState` card centred in the viewport, in a
 * container the page supplies itself because this segment has no shell layout above it. Without
 * the container the notice arrived from the top-start corner and settled in the middle.
 */
export default function OfflineLoading() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-consumer items-center justify-center px-5 py-16">
      <PageSkeleton variant="prose" count={3} />
    </div>
  );
}
