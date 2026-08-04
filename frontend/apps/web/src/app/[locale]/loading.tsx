import { PageSkeleton } from '@/components/states';

export default function LocaleLoading() {
  return (
    <div className="mx-auto w-full max-w-consumer px-5 py-10 md:px-8 xl:px-12">
      <PageSkeleton variant="grid" />
    </div>
  );
}
