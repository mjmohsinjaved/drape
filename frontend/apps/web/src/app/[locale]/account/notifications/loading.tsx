import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. Header, then the notification preferences.
 */
export default function AccountNotificationsLoading() {
  return <PageSkeleton variant="form" lead="header" />;
}
