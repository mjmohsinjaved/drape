import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Ranked rows with `w-20` `aspect-card` thumbnails, under the screen heading.
 */
export default function ConsumerShortlistLoading() {
  return <PageSkeleton variant="list" lead="header" />;
}
