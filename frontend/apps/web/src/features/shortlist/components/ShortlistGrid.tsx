'use client';

import { useCallback, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Callout } from '@repo/ui';

import { formatMoney } from '@/features/catalog-browse/lib/format';
import { removeShortlistItem } from '@/features/shortlist/api/endpoints';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { ShortlistItem } from '@/features/shortlist/api/types';
import type { Locale } from '@/i18n/config';

export interface ShortlistGridProps {
  locale: Locale;
  items: ShortlistItem[];
}

export function ShortlistGrid({ locale, items }: ShortlistGridProps) {
  const t = useTranslations('shortlist');
  const messageFor = useErrorMessage('shortlist');
  const router = useRouter();

  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const remove = useCallback(
    (item: ShortlistItem): void => {
      setErrorCode(null);
      setPendingId(item.id);
      void removeShortlistItem(item.id)
        .then(() => {
          router.refresh();
        })
        .catch((error: unknown) => {
          setErrorCode(resolveErrorCode(error));
        })
        .finally(() => {
          setPendingId(null);
        });
    },
    [router],
  );

  return (
    <div className="flex flex-col gap-4">
      {errorCode !== null ? <Callout tone="warning">{messageFor(errorCode)}</Callout> : null}

      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-5">
        {items.map((item, index) => {
          const price = formatMoney(locale, item.price, item.currency);
          const href =
            item.latestResultId === null
              ? routes.garment(locale, item.garmentId)
              : routes.render(locale, item.latestResultId);

          return (
            <li key={item.id}>
              <article className="overflow-hidden rounded-xl bg-surface shadow-sm">
                <div className="relative">
                  <Link
                    href={href}
                    className="block focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                  >
                    <div className="aspect-card w-full overflow-hidden bg-surface-sunken">
                      {item.renderThumbnailUrl === null ? null : (
                        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the image optimiser.
                        <img
                          src={item.renderThumbnailUrl}
                          alt={t('list.renderAlt', { garment: item.garmentTitle })}
                          className="size-full object-contain"
                          loading="lazy"
                        />
                      )}
                    </div>
                  </Link>

                  <span className="absolute start-2 top-2 rounded-full bg-overlay px-2.5 py-1 text-xs font-bold text-brand-fg">
                    {t('list.rank', { rank: index + 1 })}
                  </span>

                  <button
                    type="button"
                    aria-label={`${t('list.remove')} — ${item.garmentTitle}`}
                    disabled={pendingId !== null}
                    onClick={() => {
                      remove(item);
                    }}
                    className="absolute end-2 top-2 inline-flex size-8 items-center justify-center rounded-full bg-canvas/95 shadow-xs transition-colors duration-fast hover:bg-canvas focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:opacity-50"
                  >
                    <Heart aria-hidden="true" className="size-4 fill-brand text-brand" />
                  </button>
                </div>

                <div className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5">
                  <h3 className="truncate font-display text-base font-semibold">
                    <Link
                      href={href}
                      className="rounded-xs focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                    >
                      {item.garmentTitle}
                    </Link>
                  </h3>
                  <p className="truncate text-xs text-ink-muted">
                    {[price ?? t('list.priceOnRequest'), item.garmentCategory]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
