import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Both homes render three squat link cards in a `sm:grid-cols-2 xl:grid-cols-3`
 * grid, with **no imagery at all**. `list` led every row with an 80 × 64 thumbnail
 * placeholder for a photo that does not exist, in a single column the page never uses.
 */
export default function DashboardLoading() {
  return <PageSkeleton variant="cards" lead="header" />;
}
