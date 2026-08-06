import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The category table under the console page header.
 */
export default function AdminCategoriesLoading() {
  return <PageSkeleton variant="table" lead="header" />;
}
