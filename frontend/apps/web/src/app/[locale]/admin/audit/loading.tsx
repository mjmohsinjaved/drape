import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The audit table under the console page header.
 */
export default function AdminAuditLoading() {
  return <PageSkeleton variant="table" lead="header" />;
}
