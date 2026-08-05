import Link from 'next/link';

import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Button, Card, CardContent, DirectionalIcon } from '@repo/ui';

import { PublicShell } from '@/components/layout/PublicShell';
import { PageSkeleton } from '@/components/states';
import { buildMetadata } from '@/lib/metadata';
import { routes } from '@/lib/routes';
import { getCurrentUser, toShellUser } from '@/lib/session';

import type { LocaleParams } from '@/lib/route-params';
import type { Metadata } from 'next';

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
          <Card>
            <CardContent className="py-6">
              <PageSkeleton variant="list" count={3} />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-2xl">{t('newArrivalsTitle')}</h2>
          <PageSkeleton variant="grid" count={4} />
        </div>
      </section>
    </PublicShell>
  );
}
