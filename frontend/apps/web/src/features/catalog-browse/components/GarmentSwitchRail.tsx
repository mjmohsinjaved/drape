import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { getCatalogGarments } from '@/features/catalog-browse/api/endpoints';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface GarmentSwitchRailProps {
  locale: Locale;
  currentGarmentId: string;
  categoryId?: string;
}

export async function GarmentSwitchRail({
  locale,
  currentGarmentId,
  categoryId,
}: GarmentSwitchRailProps) {
  const t = await getTranslations({ locale, namespace: 'browse' });
  const result = await getCatalogGarments({ categoryId, limit: 12 });

  if (!result.ok) return null;

  const garments = result.data.filter((garment) => garment.primaryImage !== null);
  if (garments.length < 2) return null;

  return (
    <section className="flex flex-col gap-2" aria-label={t('switchRail.title')}>
      <h2 className="text-xs font-semibold uppercase text-ink-muted">
        {t('switchRail.title')}
      </h2>

      <ul className="scrollbar-none flex gap-3 overflow-x-auto pb-1">
        {garments.map((garment) => {
          const isCurrent = garment.id === currentGarmentId;
          const title =
            locale === 'ur' && garment.titleUr !== null ? garment.titleUr : garment.title;

          return (
            <li key={garment.id} className="w-24 shrink-0">
              <Link
                href={routes.garment(locale, garment.slug)}
                aria-current={isCurrent ? 'page' : undefined}
                className={`block overflow-hidden rounded-md border-2 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
                  isCurrent ? 'border-brand' : 'border-transparent hover:border-line-strong'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed thumbnail URL, must not be cached by the image optimiser. */}
                <img
                  src={garment.primaryImage?.thumbnailUrl ?? garment.primaryImage?.url}
                  alt={title}
                  loading="lazy"
                  className="aspect-card w-full bg-surface-sunken object-cover"
                />
              </Link>
              <p className="mt-1 truncate text-xs font-medium text-ink-muted">{title}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
