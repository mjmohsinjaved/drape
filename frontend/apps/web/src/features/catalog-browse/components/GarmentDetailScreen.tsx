import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button, DirectionalIcon } from '@repo/ui';

import { ScreenError } from '@/components/states';
import { getCatalogGarment } from '@/features/catalog-browse/api/endpoints';
import { GarmentSwitchRail } from '@/features/catalog-browse/components/GarmentSwitchRail';
import { formatMoney, imageAlt } from '@/features/catalog-browse/lib/format';
import { SavedTryOnsRail } from '@/features/renders/components/SavedTryOnsRail';
import { TryOnCta } from '@/features/tryon/components/TryOnCta';
import { TryOnTray } from '@/features/tryon/components/TryOnTray';
import { isRetryableCode } from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface GarmentDetailScreenProps {
  locale: Locale;
  slug: string;
  isAuthenticated: boolean;
}

export async function GarmentDetailScreen({
  locale,
  slug,
  isAuthenticated,
}: GarmentDetailScreenProps) {
  const t = await getTranslations({ locale, namespace: 'browse' });
  const result = await getCatalogGarment(slug);

  if (!result.ok) {
    if (result.error.statusCode === 404) notFound();

    const key = `errors.${result.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.detailTitle')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={result.error.requestId}
        retryable={isRetryableCode(result.error.errorCode)}
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href={routes.browse(locale)}>{t('detail.backToBrowse')}</Link>
          </Button>
        }
      />
    );
  }

  const garment = result.data;
  const title = locale === 'ur' && garment.titleUr ? garment.titleUr : garment.title;
  const price = formatMoney(locale, garment.price, garment.currency);

  const heroImage = garment.primaryImage ?? garment.images[0] ?? null;
  const heroAlt = imageAlt(
    heroImage?.altText ?? null,
    t('detail.imageAlt', { title, index: 1, total: 1 }),
  );

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Link
        href={routes.browse(locale)}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        <DirectionalIcon>
          <ChevronLeft aria-hidden="true" className="size-4" />
        </DirectionalIcon>
        {t('detail.backToBrowse')}
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-10">
        <TryOnCta
          locale={locale}
          garmentId={garment.id}
          garmentTitle={title}
          catalogImageUrl={heroImage?.url ?? null}
          catalogImageAlt={heroAlt}
          garmentThumbnailUrl={garment.primaryImage?.thumbnailUrl ?? garment.primaryImage?.url}
          isAuthenticated={isAuthenticated}
          returnTo={routes.garment(locale, garment.slug)}
        />

        <div className="flex flex-col gap-5">
          <header className="flex flex-col gap-2">
            <h1 className="font-display text-3xl text-balance md:text-4xl">{title}</h1>

            <p className="text-lg">
              <span className="font-semibold">{price ?? t('detail.priceOnRequest')}</span>
              <span className="text-ink-muted"> · {t(`modes.${garment.mode}`)}</span>
            </p>

            <p className="text-sm text-ink-muted">
              {[
                garment.fabric,
                t(`weights.${garment.embellishmentWeight}`),
                garment.sizes.length > 0
                  ? `${t('detail.sizes')} ${garment.sizes.join(', ')}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </header>
          <GarmentSwitchRail locale={locale} currentGarmentId={garment.id} />
        </div>
      </div>

      {isAuthenticated ? (
        <SavedTryOnsRail locale={locale} currentGarmentId={garment.id} />
      ) : null}

      <TryOnTray locale={locale} />
    </div>
  );
}
