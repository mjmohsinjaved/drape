import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The page is a `DeniedState` card **vertically centred** in the viewport
 * (`mx-auto flex min-h-dvh max-w-consumer items-center justify-center`), and it supplies that
 * container itself — this segment has no shell layout above it. The bare fallback painted
 * full-bleed and top-aligned, so the notice dropped into the middle of the screen from the top
 * corner. The container is reproduced here; the prose block is the right shape for the notice.
 */
export default function NoAccessLoading() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-consumer items-center justify-center px-5 py-16">
      <PageSkeleton variant="prose" count={3} />
    </div>
  );
}
