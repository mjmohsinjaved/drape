import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The same grid as `/browse`, under the category heading.
 */
export default function PublicBrowseCategorySlugLoading() {
  return <PageSkeleton variant="grid" lead="header" />;
}
