import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Header, then the sign-in and security panels.
 */
export default function AccountSecurityLoading() {
  return <PageSkeleton variant="form" lead="header" />;
}
