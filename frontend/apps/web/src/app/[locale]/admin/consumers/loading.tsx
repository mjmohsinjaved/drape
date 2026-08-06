import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The consumer table under the console page header.
 */
export default function AdminConsumersLoading() {
  return <PageSkeleton variant="table" lead="header" />;
}
