import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Four stat tiles sit **above** the table (`grid gap-3 sm:grid-cols-2
 * xl:grid-cols-4`) — the screen draws exactly that shape in its own pending state. Without
 * the tiles the table landed ~96 px too high and everything below it jumped.
 */
export default function AdminCatalogHealthLoading() {
  return <PageSkeleton variant="table" lead="stats" />;
}
