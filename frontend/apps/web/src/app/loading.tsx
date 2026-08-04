import { PageSkeleton } from '@/components/states';

/**
 * The root loading state. A skeleton shaped like the first thing most visitors see — the
 * catalog grid — rather than a bare spinner (D-5, D-8).
 */
export default function RootLoading() {
  return (
    <div className="mx-auto w-full max-w-consumer px-5 py-10 md:px-8 xl:px-12">
      <PageSkeleton variant="grid" />
    </div>
  );
}
