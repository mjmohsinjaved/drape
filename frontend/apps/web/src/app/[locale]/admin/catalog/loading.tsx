import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The catalog table under the console page header.
 */
export default function AdminCatalogLoading() {
  return <PageSkeleton variant="table" lead="header" />;
}
