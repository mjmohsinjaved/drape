import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The catalog grid, matched breakpoint for breakpoint, under the screen heading.
 * This is the §9.1 screen with a number on it, so its skeleton is the one that must not move.
 */
export default function PublicBrowseLoading() {
  return <PageSkeleton variant="grid" lead="header" />;
}
