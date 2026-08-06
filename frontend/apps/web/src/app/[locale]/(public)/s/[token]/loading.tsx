import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. What is shared is a **ranked shortlist**, and the owner’s own view of the same
 * data is a card list — which is why `/shortlist` is `list`. The public mirror of it is not a
 * catalog grid.
 */
export default function PublicSTokenLoading() {
  return <PageSkeleton variant="list" lead="header" />;
}
