import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TestRenderScreen } from '@/features/catalog/components/TestRenderScreen';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { serverGet } from '@/lib/server-api';

import type {
  AdminGarment,
  ReferenceModel,
  TestRender,
} from '@/features/catalog/types/admin-catalog';
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
  const t = await getTranslations({ locale, namespace: 'admin.catalog.testRender' });

  return buildMetadata({
    locale,
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: routes.admin.garmentTestRender(locale, garmentId),
  });
}

/**
 * A-11 — the test-render approval screen.
 *
 * The garment, the stored render and the reference models are read together so the comparison is
 * on screen at first paint: this is a judgement made by looking at two images side by side, and
 * a screen that arrives one image at a time makes it worse.
 */
export default async function AdminGarmentTestRenderPage({ params }: Props) {
  const { locale, garmentId } = await params;
  setRequestLocale(locale);

  const [garment, testRender, models] = await Promise.all([
    serverGet<AdminGarment>(`/admin/garments/${garmentId}`),
    serverGet<TestRender>(`/admin/garments/${garmentId}/test-render`),
    serverGet<ReferenceModel[]>('/admin/reference-models'),
  ]);

  return (
    <TestRenderScreen
      locale={locale}
      garmentId={garmentId}
      initialGarment={garment.ok ? garment.data : undefined}
      initialTestRender={testRender.ok ? testRender.data : undefined}
      initialReferenceModels={models.ok ? models.data : undefined}
    />
  );
}
