import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. A record page — signup date, last activity, generations, shortlist size. `detail`
 * led with a full-width 3:4 image block for a hero photo that does not exist here, and
 * S-10 means an admin can never be shown a consumer photo in the first place.
 */
export default function AdminConsumersUserIdLoading() {
  return <PageSkeleton variant="prose" lead="header" />;
}
