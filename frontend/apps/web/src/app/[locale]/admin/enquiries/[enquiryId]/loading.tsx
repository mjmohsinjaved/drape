import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. An enquiry thread — the message and the studio’s reply. `detail` reserved a
 * full-width 3:4 image block for a hero image the screen has never had.
 */
export default function AdminEnquiriesEnquiryIdLoading() {
  return <PageSkeleton variant="prose" lead="header" />;
}
