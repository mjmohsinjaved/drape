import Link from 'next/link';

import { MessageSquare } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button, Card, CardContent, EmptyState } from '@repo/ui';

import { DeniedState, ScreenError, SignedOutState } from '@/components/states';
import { formatMoney } from '@/features/catalog-browse/lib/format';
import { getShortlistServer } from '@/features/shortlist/api/server';
import { ShortlistGrid } from '@/features/shortlist/components/ShortlistGrid';
import { TryOnTray } from '@/features/tryon/components/TryOnTray';
import {
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
} from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { ShortlistBudget } from '@/features/shortlist/api/types';
import type { Locale } from '@/i18n/config';

export interface ShortlistScreenProps {
  locale: Locale;
}

export async function ShortlistScreen({ locale }: ShortlistScreenProps) {
  const t = await getTranslations({ locale, namespace: 'shortlist' });
  const result = await getShortlistServer();

  if (!result.ok) {
    if (isAuthenticationRequired(result.error.errorCode)) {
      return <SignedOutState />;
    }

    if (isPermissionDenied(result.error.errorCode)) return <DeniedState locale={locale} />;

    const key = `errors.${result.error.errorCode}`;
    return (
      <ScreenError
        title={t('errors.title')}
        description={t.has(key) ? t(key) : t('errors.description')}
        requestId={result.error.requestId}
        retryable={isRetryableCode(result.error.errorCode)}
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href={routes.browse(locale)}>{t('empty.action')}</Link>
          </Button>
        }
      />
    );
  }

  const { items, budget } = result.data;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-balance md:text-4xl">{t('list.title')}</h1>
        <p className="max-w-prose text-ink-muted">{t('list.subtitle')}</p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="primary" size="lg">
                <Link href={routes.browse(locale)}>{t('empty.action')}</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href={routes.renders(locale)}>{t('empty.secondaryAction')}</Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">{t('list.count', { count: items.length })}</p>

            <ShortlistGrid locale={locale} items={items} />
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
            <BudgetTotal locale={locale} budget={budget} />

            <div className="flex flex-col gap-2">
              <Button
                asChild
                variant="primary"
                size="lg"
                fullWidth
                startIcon={<MessageSquare aria-hidden="true" />}
              >
                <Link href={routes.enquiryNew(locale)}>{t('enquire.action')}</Link>
              </Button>
              <p className="text-center text-sm text-ink-muted">{t('enquire.hint')}</p>
            </div>
          </aside>
        </div>
      )}

      <TryOnTray locale={locale} />
    </div>
  );
}

async function BudgetTotal({ locale, budget }: { locale: Locale; budget: ShortlistBudget }) {
  const t = await getTranslations({ locale, namespace: 'shortlist.budget' });

  const total = formatMoney(locale, budget.total, budget.currency);
  const ceiling =
    budget.budgetCeiling === null
      ? null
      : formatMoney(locale, budget.budgetCeiling, budget.currency);
  const over =
    budget.budgetCeiling !== null && budget.total > budget.budgetCeiling
      ? formatMoney(locale, budget.total - budget.budgetCeiling, budget.currency)
      : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <h2 className="text-xs font-semibold uppercase text-ink-muted">{t('heading')}</h2>

        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-muted">{t('pieces')}</dt>
            <dd className="font-semibold">{budget.itemCount}</dd>
          </div>

          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-muted">{t('totalLabel')}</dt>
            <dd className="font-bold">{total ?? t('hidden')}</dd>
          </div>

          {ceiling === null ? null : (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-muted">{t('budgetLabel')}</dt>
              <dd className="font-semibold">{ceiling}</dd>
            </div>
          )}
        </dl>

        {budget.budgetBand === null ? (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <p className="text-sm text-ink-muted">{t('noBand')}</p>
            <Button asChild variant="link" size="sm" className="w-fit">
              <Link href={routes.account(locale)}>{t('setBand')}</Link>
            </Button>
          </div>
        ) : budget.withinBudget === true ? (
          <p className="border-t border-line pt-3 text-sm text-success">{t('within')}</p>
        ) : over !== null ? (
          <p className="border-t border-line pt-3 text-sm text-pretty text-ink-muted">
            {t('over', { amount: over })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
