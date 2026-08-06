import { PageSkeleton } from '@/components/states';

/**
 * D-5, D-8. C-37…C-39 are a stack of cards — what is held, the export, the deletion — not
 * running prose. Its three sibling account segments are all `form`, and a page that shifted
 * differently from the three beside it in the same shell was the tell that `prose` was wrong.
 */
export default function AccountDataLoading() {
  return <PageSkeleton variant="form" lead="header" />;
}
