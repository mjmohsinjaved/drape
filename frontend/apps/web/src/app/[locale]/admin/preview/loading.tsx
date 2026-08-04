import { PageSkeleton } from '@/components/states';

/** Aspect-matched skeleton, not a bare spinner (D-5, D-8). */
export default function AdminPreviewLoading() {
  return <PageSkeleton variant="grid" />;
}
