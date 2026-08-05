import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. History is a **card list** — render thumbnail beside the garment details (C-25,
 * §6.2: "History and shortlist are card lists") — so the placeholder is a list, not a grid. A
 * grid skeleton here would reflow the whole page the moment the real rows arrived.
 */
export default function ConsumerRendersLoading() {
  return <PageSkeleton variant="list" count={6} />;
}
