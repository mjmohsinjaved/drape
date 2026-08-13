import Link from 'next/link';

import { getTranslations } from 'next-intl/server';

import { listResultsServer } from '@/features/renders/api/server';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface SavedTryOnsRailProps {
  locale: Locale;
  currentGarmentId: string;
}

export async function SavedTryOnsRail({ locale, currentGarmentId }: SavedTryOnsRailProps) {
  const t = await getTranslations({ locale, namespace: 'browse' });
  const result = await listResultsServer({ page: 1, limit: 12 });

  if (!result.ok || result.data.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-label={t('savedTryOns.title')}>
      <h2 className="text-xs font-semibold uppercase text-ink-muted">
        {t('savedTryOns.title')}
      </h2>

      <ul className="scrollbar-none flex gap-3 overflow-x-auto pb-1">
        {result.data.map((item) => {
          const isCurrent = item.garmentId === currentGarmentId;
          const href =
            item.garmentId !== null && item.garmentAvailable
              ? routes.garment(locale, item.garmentId)
              : routes.render(locale, item.id);

          return (
            <li key={item.id} className="w-36 shrink-0">
              <Link
                href={href}
                aria-current={isCurrent ? 'true' : undefined}
                className={`block overflow-hidden rounded-md border-2 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
                  isCurrent ? 'border-brand' : 'border-transparent hover:border-line-strong'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
                <img
                  src={item.thumbnailUrl ?? item.url}
                  alt={t('savedTryOns.alt', { title: item.garmentTitle })}
                  loading="lazy"
                  className="aspect-card w-full bg-surface-sunken object-contain"
                />
              </Link>
              <p
                className={`mt-1 truncate text-xs font-medium ${
                  isCurrent ? 'text-ink' : 'text-ink-muted'
                }`}
              >
                {item.garmentTitle}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
