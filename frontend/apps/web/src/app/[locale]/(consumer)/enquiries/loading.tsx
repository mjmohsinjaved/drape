import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. A list of enquiries under the screen heading.
 */
export default function ConsumerEnquiriesLoading() {
  return <PageSkeleton variant="list" lead="header" />;
}
