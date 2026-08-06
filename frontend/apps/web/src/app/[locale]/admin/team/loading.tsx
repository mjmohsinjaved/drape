import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The team table under the console page header.
 */
export default function AdminTeamLoading() {
  return <PageSkeleton variant="table" lead="header" />;
}
