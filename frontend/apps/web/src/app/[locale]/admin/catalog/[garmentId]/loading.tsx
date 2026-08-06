import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. The editor is `xl:grid-cols-3` — form panels beside a gallery/status/actions
 * sidebar. `form` drew one full-width column ending in a submit bar the editor does not
 * have, so the sidebar had nowhere to land and the whole body reflowed at `xl`.
 */
export default function AdminCatalogGarmentIdLoading() {
  return <PageSkeleton variant="detail" lead="header" />;
}
