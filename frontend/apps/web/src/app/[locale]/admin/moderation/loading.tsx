import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The moderation queue is a thumbnail grid, under the console page header.
 */
export default function AdminModerationLoading() {
  return <PageSkeleton variant="grid" lead="header" />;
}
