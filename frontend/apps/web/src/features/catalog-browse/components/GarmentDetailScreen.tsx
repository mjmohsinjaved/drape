import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ChevronLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import {
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  ErrorState,
  ImageGallery,
  ShortlistingCaption,
} from '@repo/ui';

import { DirectionalIcon } from '@/components/DirectionalIcon';
import { getCatalogGarment } from '@/features/catalog-browse/api/endpoints';
import { facetLabel, formatMoney, imageAlt } from '@/features/catalog-browse/lib/format';
import { TryOnButton } from '@/features/tryon/components/TryOnButton';
import { TryOnTray } from '@/features/tryon/components/TryOnTray';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface GarmentDetailScreenProps {
  locale: Locale;
  slug: string;
  isAuthenticated: boolean;
}

/**
 * Garment detail — C-18: gallery, price, fabric, sizes, and **one** prominent Try it on.
 *
 * Server-rendered, image-led and generous (§6.2). The gallery is a small client island because
 * it swaps images; everything else — the copy, the description list, the breadcrumb — is HTML.
 *
 * A garment that is unpublished, archived or has no approved test render is `GARMENT_NOT_FOUND`
 * and indistinguishable from one that never existed (E-10, S-9), so it renders the app's
 * not-found screen rather than leaking that it is merely hidden.
 */
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
      <ErrorState
        title={t('errors.detailTitle')}
        description={t.has(key) ? t(key) : t('errors.description')}
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
  const description =
    locale === 'ur' && garment.descriptionUr ? garment.descriptionUr : garment.description;
  const price = formatMoney(locale, garment.price, garment.currency);
  const deposit = formatMoney(locale, garment.deposit, garment.currency);

  // The gallery is ordered by `position` server-side; a garment with no images still renders,
  // with the "photo coming soon" placeholder rather than an empty frame.
  const gallery = garment.images.map((image, index) => ({
    id: `${garment.id}-${String(image.position)}-${String(index)}`,
    src: image.url,
    alt: imageAlt(
      image.altText,
      t('detail.imageAlt', { title, index: index + 1, total: garment.images.length }),
    ),
  }));

  return (
    <div className="flex flex-col gap-8 md:gap-12">
      <Link
        href={routes.browse(locale)}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
      >
        <DirectionalIcon>
          <ChevronLeft aria-hidden="true" className="size-4" />
        </DirectionalIcon>
        {t('detail.backToBrowse')}
      </Link>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {gallery.length === 0 ? (
          <div className="flex aspect-card w-full items-center justify-center rounded-xl bg-surface-sunken px-4 text-center text-sm text-ink-subtle">
            {t('card.noImage')}
          </div>
        ) : (
          <ImageGallery
            images={gallery}
            ratio="garment"
            label={t('detail.galleryLabel', { title })}
            // Each thumbnail is a tab whose only accessible name comes from here. Without it,
            // `ImageGallery` falls back to a hardcoded `View image 2` — English under `ur` (C-41).
            thumbnailLabel={(_image, position) =>
              t('detail.thumbnailLabel', { position: position + 1 })
            }
          />
        )}

        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-3">
            <h1 className="font-display text-3xl text-balance md:text-4xl">{title}</h1>

            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xl font-medium">{price ?? t('detail.priceOnRequest')}</p>
              <Badge variant={garment.mode === 'RENTAL' ? 'gold' : 'neutral'}>
                {t(`modes.${garment.mode}`)}
              </Badge>
            </div>
          </header>

          {/* The one primary action on this screen (§6.2). */}
          <TryOnButton
            locale={locale}
            garmentId={garment.id}
            garmentTitle={title}
            garmentThumbnailUrl={garment.primaryImage?.thumbnailUrl ?? garment.primaryImage?.url}
            isAuthenticated={isAuthenticated}
            returnTo={routes.garment(locale, garment.slug)}
          />

          <ShortlistingCaption>{t('detail.tryOnNote')}</ShortlistingCaption>

          {description ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-lg font-medium">{t('detail.about')}</h2>
              <p className="max-w-prose text-pretty text-ink-muted">{description}</p>
            </section>
          ) : null}

          <DescriptionList>
            {garment.fabric ? (
              <DescriptionItem term={t('detail.fabric')}>{garment.fabric}</DescriptionItem>
            ) : null}
            {garment.sizes.length > 0 ? (
              <DescriptionItem term={t('detail.sizes')}>{garment.sizes.join(', ')}</DescriptionItem>
            ) : null}
            {garment.categoryName ? (
              <DescriptionItem term={t('detail.category')}>{garment.categoryName}</DescriptionItem>
            ) : null}
            <DescriptionItem term={t('detail.mode')}>{t(`modes.${garment.mode}`)}</DescriptionItem>
            <DescriptionItem term={t('filters.weight')}>
              {t(`weights.${garment.embellishmentWeight}`)}
            </DescriptionItem>
            {deposit === null ? null : (
              <DescriptionItem term={t('detail.deposit')}>{deposit}</DescriptionItem>
            )}
          </DescriptionList>

          {garment.colors.length > 0 || garment.styleTags.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-medium">{t('detail.styleTags')}</h2>
              <ul className="flex flex-wrap gap-2">
                {[...garment.colors, ...garment.styleTags].map((tag) => (
                  <li key={tag}>
                    <Badge variant="outline">{facetLabel(tag, null)}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <TryOnTray locale={locale} />
    </div>
  );
}
