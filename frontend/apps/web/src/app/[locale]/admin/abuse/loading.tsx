import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The abuse table under the console page header.
 */
export default function AdminAbuseLoading() {
  return <PageSkeleton variant="table" lead="header" />;
}
