import Link from 'next/link';

import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Button, Card, CardContent, DirectionalIcon, EmptyState, ErrorState } from '@repo/ui';

import { PublicShell } from '@/components/layout/PublicShell';
import {
  getCatalogGarments,
  getPublicCategories,
} from '@/features/catalog-browse/api/endpoints';
import { GarmentCard } from '@/features/catalog-browse/components/GarmentCard';
import { categoryName } from '@/features/catalog-browse/lib/category-name';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { getCurrentUser, toShellUser } from '@/lib/session';

import type { Locale } from '@/i18n/config';
import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

/** One row of four on desktop, two on mobile. */
const NEW_ARRIVALS_COUNT = 4;

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'catalog.landing' });

  return buildMetadata({
    locale,
    title: t('metaTitle'),
    description: t('metaDescription'),
    path: routes.home(locale),
    noIndex: false,
  });
}

/**
 * The public landing — PRD C-1, ARCHITECTURE §6.6.
 *
 * Reachable signed out. Browsing, categories, search, filters and garment detail are all
 * public; only the actions that involve her photo ask for an account.
 *
 * The copy is shortlisting copy (§9.4): trying a piece on helps her narrow a shortlist. It
 * does not promise accuracy, does not frame a render as final, and never says "see yourself
 * in".
 *
 * TODO(W2): replace the two placeholder blocks with the featured-category rail and the
 * new-arrivals grid, read server-side through `@/lib/server-api`.
 */
export default async function LandingPage({ params }: LocaleParams) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'catalog.landing' });
  const user = await getCurrentUser();

  return (
    <PublicShell locale={locale} user={user ? toShellUser(user) : undefined}>
      <section className="flex flex-col gap-8 py-6 md:py-12">
        <div className="flex max-w-prose flex-col gap-5">
          <h1 className="text-3xl md:text-4xl">{t('heroTitle')}</h1>
          <p className="text-lg text-ink-muted">{t('heroBody')}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="primary" size="lg" className="w-full sm:w-auto">
              <Link href={routes.browse(locale)}>
                {t('heroAction')}
                <DirectionalIcon>
                  <ArrowRight aria-hidden="true" className="size-4" />
                </DirectionalIcon>
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
              <Link href={routes.signup(locale)}>{t('heroSecondary')}</Link>
            </Button>
          </div>
          {/* The shortlisting frame, stated once and plainly, above the fold. */}
          <p className="text-sm text-ink-subtle">{t('heroNote')}</p>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-2xl">{t('categoriesTitle')}</h2>
          <CategoryRail locale={locale} />
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-2xl">{t('newArrivalsTitle')}</h2>
          <NewArrivals locale={locale} />
        </div>
      </section>
    </PublicShell>
  );
}

/**
 * The A-6 rail: categories in their admin-defined order, which is what drives the consumer
 * browse screen. Top-level only — sub-categories are one level deep (A-5) and belong on the
 * category page, not here.
 */
async function CategoryRail({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'catalog.landing' });
  const result = await getPublicCategories();

  if (!result.ok) {
    return (
      <ErrorState
        title={t('categoriesErrorTitle')}
        description={t('categoriesErrorBody')}
        reference={result.error.requestId}
      />
    );
  }

  if (result.data.length === 0) {
    // D-6: name the next step rather than the absence.
    return (
      <EmptyState
        title={t('categoriesEmptyTitle')}
        description={t('categoriesEmptyBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.browse(locale)}>{t('heroAction')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-2">
        {result.data.map((category) => (
          <Link
            key={category.id}
            href={routes.browseCategory(locale, category.slug)}
            className="focus-ring touch-target flex items-center justify-between gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-surface-raised"
          >
            <span className="text-base">{categoryName(category, locale)}</span>
            <DirectionalIcon>
              <ArrowRight aria-hidden="true" className="size-4 text-ink-subtle" />
            </DirectionalIcon>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * The newest published pieces. Every one carries an approved test render — that is enforced by
 * the catalog projection itself (E-10), not by anything asked for here.
 */
async function NewArrivals({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'catalog.landing' });
  const result = await getCatalogGarments({ page: 1, limit: NEW_ARRIVALS_COUNT, sortBy: 'newest' });

  if (!result.ok) {
    return (
      <ErrorState
        title={t('newArrivalsErrorTitle')}
        description={t('newArrivalsErrorBody')}
        reference={result.error.requestId}
      />
    );
  }

  if (result.data.length === 0) {
    return (
      <EmptyState
        title={t('newArrivalsEmptyTitle')}
        description={t('newArrivalsEmptyBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.browse(locale)}>{t('heroAction')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {result.data.map((garment, index) => (
        // The first row is the LCP candidate on this route too (§9.1).
        <GarmentCard key={garment.id} locale={locale} garment={garment} priority={index < 2} />
      ))}
    </div>
  );
}
