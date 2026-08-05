import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The wait is a single narrow column — a heading, a progress track and four stage
 * rows — so the placeholder is prose-shaped. It is on screen for a fraction of a second before
 * the staged sequence takes over, and the staged sequence is what C-19 and §10.3 actually ask
 * for: this is never the loading state she watches for seven seconds.
 */
export default function ConsumerTryonJobIdLoading() {
  return <PageSkeleton variant="prose" />;
}
