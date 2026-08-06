import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The enquiry table under the console page header.
 */
export default function AdminEnquiriesLoading() {
  return <PageSkeleton variant="table" lead="header" />;
}
