import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. `PhotoList` is `grid-cols-2 md:grid-cols-3` with no `xl:` step, so the skeleton
 * stops at three too — at four it reflowed the whole library at 1280 px. `lead="header"`
 * reserves the screen heading and its lead paragraph, which the page renders above the grid.
 */
export default function ConsumerPhotosLoading() {
  return <PageSkeleton variant="grid" lead="header" columns={3} count={6} />;
}
