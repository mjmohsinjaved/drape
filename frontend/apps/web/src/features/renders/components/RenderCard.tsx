import Link from 'next/link';

import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@repo/ui';

import { routes } from '@/lib/routes';

import type { ResultListItem, Verdict } from '@/features/renders/api/types';
import type { Locale } from '@/i18n/config';

export interface RenderCardProps {
  locale: Locale;
  result: ResultListItem;
  verdict: Verdict | undefined;
}

export function RenderCard({ locale, result, verdict }: RenderCardProps) {
  const t = useTranslations('renders.list.card');
  const tVerdict = useTranslations('renders.verdict');
  const format = useFormatter();

  const source = result.thumbnailUrl ?? result.url;

  return (

    <article className="flex flex-col gap-2">
      <Link
        href={routes.render(locale, result.id)}
        className="rounded-xl focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        <div className="aspect-card w-full overflow-hidden rounded-xl bg-surface-sunken shadow-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser. */}
          <img
            src={source}
            alt={t('renderAlt', { garment: result.garmentTitle })}
            className="size-full object-contain"
            loading="lazy"
          />
        </div>
      </Link>

      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="font-display text-base font-semibold">
          <Link
            href={routes.render(locale, result.id)}
            className="rounded-xs focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            {result.garmentTitle}
          </Link>
        </h3>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <p className="text-xs text-ink-subtle">
            {t('triedOn', { date: format.dateTime(new Date(result.createdAt), 'short') })}
          </p>

          <Badge variant={verdict === 'LOVE_IT' ? 'brand' : 'neutral'}>
            {verdict === undefined ? t('noVerdict') : tVerdict(verdict)}
          </Badge>
        </div>

        {result.garmentAvailable ? null : (
          <Badge variant="outline" className="w-fit">
            {t('unavailable')}
          </Badge>
        )}
      </div>
    </article>
  );
}
