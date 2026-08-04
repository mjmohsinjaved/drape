import { PageSkeleton } from '@/components/states';

/** Group-level fallback, shown while the shell above a leaf segment resolves (D-5, D-8). */
export default function AuthGroupLoading() {
  return <PageSkeleton variant="form" />;
}
