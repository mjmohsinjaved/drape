import Link from 'next/link';

import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@repo/ui';

import { formatMoney } from '@/features/catalog-browse/lib/format';
import { routes } from '@/lib/routes';

import type { ResultListItem, Verdict } from '@/features/renders/api/types';
import type { Locale } from '@/i18n/config';

export interface RenderCardProps {
  locale: Locale;
  result: ResultListItem;
  /** Joined from the shortlist, since the history row does not carry it (§4.20). */
  verdict: Verdict | undefined;
}

/**
 * One row of history — C-25.
 *
 * > "each showing the render thumbnail beside the catalog image, the garment name, category,
 * > price, generation date and her verdict"
 *
 * Everything on it comes from the `tryon_results` snapshot columns, which is what makes C-29
 * work: when the garment is withdrawn the row is unchanged, the piece is labelled unavailable
 * and the try-on action disappears — but **her render is never hidden**.
 *
 * Thumbnails only (§9.1). The full render is fetched when she opens it.
 */
export function RenderCard({ locale, result, verdict }: RenderCardProps) {
  const t = useTranslations('renders.list.card');
  const tVerdict = useTranslations('renders.verdict');
  const format = useFormatter();

  const price = formatMoney(locale, result.garmentPrice, result.garmentCurrency);
  const source = result.thumbnailUrl ?? result.url;

  return (
    <article className="flex gap-4">
      <Link
        href={routes.render(locale, result.id)}
        className="w-24 shrink-0 rounded-lg focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] sm:w-32"
      >
        {/*
          A signed, short-lived URL (§3.4) in a fixed 3:4 box. Deliberately a plain <img>: the
          image optimiser would cache a URL that expires within minutes, and the cached entry
          would then 403 on her next visit.
        */}
        <div className="aspect-card w-full overflow-hidden rounded-lg bg-surface-sunken">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
          <img
            src={source}
            alt={t('renderAlt', { garment: result.garmentTitle })}
            className="size-full object-cover"
            loading="lazy"
          />
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="text-base font-medium">
          <Link
            href={routes.render(locale, result.id)}
            className="rounded-xs focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            {result.garmentTitle}
          </Link>
        </h3>

        <p className="text-sm text-ink-muted">{result.garmentCategory}</p>
        <p className="text-sm">{price ?? t('priceOnRequest')}</p>
        <p className="text-xs text-ink-subtle">
          {t('triedOn', { date: format.dateTime(new Date(result.createdAt), 'short') })}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {verdict === undefined ? null : (
            <Badge variant={verdict === 'LOVE_IT' ? 'brand' : 'neutral'}>
              {tVerdict(verdict)}
            </Badge>
          )}
          {result.garmentAvailable ? null : (
            <Badge variant="outline">{t('unavailable')}</Badge>
          )}
        </div>
      </div>
    </article>
  );
}
