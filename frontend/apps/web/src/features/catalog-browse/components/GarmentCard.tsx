import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Badge, ImageWithFallback } from '@repo/ui';

import { facetLabel, formatMoney, imageAlt } from '@/features/catalog-browse/lib/format';
import { routes } from '@/lib/routes';

import type { CatalogGarmentSummary } from '@/features/catalog-browse/api/types';
import type { Locale } from '@/i18n/config';

export interface GarmentCardProps {
  locale: Locale;
  garment: CatalogGarmentSummary;
  /**
   * The first row of the grid is the LCP candidate. Priority-loading those and lazy-loading the
   * rest is what keeps first contentful paint on 4G under 2.5s (§9.1).
   */
  priority?: boolean;
}

/**
 * One card in the browse grid — §6.2's consumer card: image first, 3:4, `--radius-xl`,
 * `--shadow-sm`, a text block below.
 *
 * A Server Component. Nothing here is interactive beyond the link, so nothing here is
 * client-side JavaScript.
 *
 * **Thumbnails only** (§9.1). The card asks for `thumbnailUrl` and only falls back to the
 * full-size URL when the API has not produced a thumbnail yet — a grid of full renders is the
 * single easiest way to miss the 4G budget. The image sits in a fixed 3:4 box so its space is
 * reserved before it loads and the grid never reflows (D-8, CLS under 0.1).
 */
export function GarmentCard({ locale, garment, priority = false }: GarmentCardProps) {
  const t = useTranslations('browse');

  const title = locale === 'ur' && garment.titleUr ? garment.titleUr : garment.title;
  const price = formatMoney(locale, garment.price, garment.currency);
  const source = garment.primaryImage?.thumbnailUrl ?? garment.primaryImage?.url ?? null;

  return (
    <article className="group flex flex-col gap-3">
      <Link
        href={routes.garment(locale, garment.slug)}
        className="rounded-xl focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        {source === null ? (
          <div className="flex aspect-card w-full items-center justify-center rounded-xl bg-surface-sunken px-4 text-center text-xs text-ink-subtle">
            {t('card.noImage')}
          </div>
        ) : (
          <ImageWithFallback
            ratio="garment"
            rounded="xl"
            className="shadow-xs"
            src={source}
            alt={imageAlt(garment.primaryImage?.altText, t('card.imageAlt', { title }))}
            // 2 cols @360, 3 @768, 4 @1200 (§6.2) — so the browser fetches the narrow variant
            // on a phone rather than a desktop-sized file over mobile data.
            sizes="(min-width: 1200px) 25vw, (min-width: 768px) 33vw, 50vw"
            priority={priority}
            fallbackLabel={t('card.noImage')}
          />
        )}
      </Link>

      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-balance">
          <Link
            href={routes.garment(locale, garment.slug)}
            className="rounded-xs focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            {title}
          </Link>
        </h3>

        <p className="text-sm text-ink-muted">
          {garment.categoryName ?? facetLabel(garment.embellishmentWeight, null)}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <p className="text-sm font-medium">{price ?? t('card.priceOnRequest')}</p>
          {garment.mode === 'RENTAL' ? (
            <Badge variant="neutral" size="sm">
              {t('modes.RENTAL')}
            </Badge>
          ) : null}
        </div>
      </div>
    </article>
  );
}
