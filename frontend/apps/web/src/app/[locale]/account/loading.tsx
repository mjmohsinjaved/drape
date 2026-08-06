import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Header, then the profile form.
 */
export default function AccountLoading() {
  return <PageSkeleton variant="form" lead="header" />;
}
