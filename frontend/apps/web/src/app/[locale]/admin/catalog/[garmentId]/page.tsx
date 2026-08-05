import { getTranslations, setRequestLocale } from 'next-intl/server';

import { GarmentEditorScreen } from '@/features/catalog/components/GarmentEditorScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type {
  AdminGarment,
  AdminGarmentImage,
} from '@/features/catalog/types/admin-catalog';
import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { LocaleParamsWith } from '@/lib/route-params';
import type { Metadata } from 'next';

type Props = LocaleParamsWith<{ garmentId: string }>;

/**
 * The console is per-request, never prerendered.
 *
 * `lib/server-api.ts` catches every throw from its axios call, including the dynamic-usage
 * signal Next raises when `cookies()` is read during a static render — so a page that reads
 * through it would prerender to a data-less shell instead of bailing to dynamic. Saying so
 * explicitly keeps every admin screen request-scoped and its session-scoped reads honest.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, garmentId } = await params;
  const t = await getTranslations({ locale, namespace: 'admin.catalog.editor' });

  return buildMetadata({
    locale,
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: routes.admin.garment(locale, garmentId),
  });
}

/**
 * A-8 … A-11 for one piece.
 *
 * Three reads, in parallel, all with the incoming session cookie (B-9): the record, its gallery
 * and the category tree the form needs. `GET /admin/garments/:id` does not embed images — §5.7
 * gives them their own routes — so the gallery is a second call rather than a nested field.
 */
export default async function AdminGarmentPage({ params }: Props) {
  const { locale, garmentId } = await params;
  setRequestLocale(locale);

  const [garment, images, categories] = await Promise.all([
    serverGet<AdminGarment>(`/admin/garments/${garmentId}`),
    serverGet<AdminGarmentImage[]>(`/admin/garments/${garmentId}/images`),
    serverGet<AdminCategory[]>('/admin/categories', { params: { includeArchived: false } }),
  ]);

  return (
    <GarmentEditorScreen
      locale={locale}
      garmentId={garmentId}
      categories={categories.ok ? categories.data : []}
      initialGarment={garment.ok ? garment.data : undefined}
      initialImages={images.ok ? images.data : undefined}
    />
  );
}
