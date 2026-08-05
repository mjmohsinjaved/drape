import Link from 'next/link';

import { MessageSquare } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button, Card, CardContent, EmptyState, ErrorState, ShortlistingCaption } from '@repo/ui';

import { DeniedState } from '@/components/states';
import { formatMoney } from '@/features/catalog-browse/lib/format';
import { DeleteMyDataLink } from '@/features/consent/components/DeleteMyDataLink';
import { getShortlistServer } from '@/features/shortlist/api/server';
import { ShortlistBoard } from '@/features/shortlist/components/ShortlistBoard';
import { TryOnTray } from '@/features/tryon/components/TryOnTray';
import { isPermissionDenied } from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { ShortlistBudget } from '@/features/shortlist/api/types';
import type { Locale } from '@/i18n/config';

export interface ShortlistScreenProps {
  locale: Locale;
}

/**
 * The shortlist — PRD C-32.
 *
 * > "Shortlist with drag-to-rank, per-item notes, and a running total against her stated budget.
 * > Persists across devices."
 *
 * Server-rendered, with the ranking board as the client island. Persistence across devices is
 * the server's — the rank column is authoritative and the draft store only holds the order
 * during a drag (§6.5).
 *
 * The empty state points at the collection, because a shortlist fills by trying pieces on, and
 * the enquiry action sits at the end of a filled one — this is where the shortlist stops being a
 * list and becomes a conversation with the studio.
 */
export async function ShortlistScreen({ locale }: ShortlistScreenProps) {
  const t = await getTranslations({ locale, namespace: 'shortlist' });
  const result = await getShortlistServer();

  if (!result.ok) {
    // S-9 / D-5: an authorisation refusal is the permission-denied state, never an error
    // state and never a raw 403.
    if (isPermissionDenied(result.error.errorCode)) return <DeniedState locale={locale} />;

    const key = `errors.${result.error.errorCode}`;
    return (
      <ErrorState
        title={t('errors.title')}
        description={t.has(key) ? t(key) : t('errors.description')}
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
        <>
          <p className="text-sm text-ink-muted">{t('list.count', { count: items.length })}</p>

          <ShortlistBoard locale={locale} items={items} />

          <BudgetTotal locale={locale} budget={budget} />

          <div className="flex flex-col gap-2">
            <Button
              asChild
              variant="primary"
              size="lg"
              startIcon={<MessageSquare aria-hidden="true" />}
            >
              <Link href={routes.enquiryNew(locale)}>{t('enquire.action')}</Link>
            </Button>
            <p className="text-sm text-ink-muted">{t('enquire.hint')}</p>
          </div>
        </>
      )}

      <ShortlistingCaption>{t('caption')}</ShortlistingCaption>

      <DeleteMyDataLink locale={locale} />

      {/* C-19: a try-on started elsewhere finishes and reports itself here too. */}
      <TryOnTray locale={locale} />
    </div>
  );
}

/**
 * The running total against her budget — C-32.
 *
 * `withinBudget` is three-valued on purpose: a consumer who never stated a band is neither
 * within her budget nor over it, and the API refuses to invent a fact about her. So does this:
 * with no band, the total is shown and the copy offers to set one rather than judging.
 *
 * Over budget is a nudge, never a block. The wording says so — it is her call, and the studio can
 * suggest something close.
 */
async function BudgetTotal({ locale, budget }: { locale: Locale; budget: ShortlistBudget }) {
  const t = await getTranslations({ locale, namespace: 'shortlist.budget' });

  const total = formatMoney(locale, budget.total, budget.currency);
  const over =
    budget.budgetCeiling !== null && budget.total > budget.budgetCeiling
      ? formatMoney(locale, budget.total - budget.budgetCeiling, budget.currency)
      : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-6">
        <h2 className="text-sm font-medium text-ink-muted">{t('heading')}</h2>

        {total === null ? (
          <p className="text-ink-muted">{t('hidden')}</p>
        ) : (
          <>
            <p className="font-display text-2xl">{total}</p>
            <p className="text-sm text-ink-muted">{t('itemCount', { count: budget.itemCount })}</p>
          </>
        )}

        {budget.budgetBand === null ? (
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-sm text-ink-muted">{t('noBand')}</p>
            <Button asChild variant="link" size="sm" className="w-fit">
              <Link href={routes.account(locale)}>{t('setBand')}</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1 pt-2">
            <p className="text-sm text-ink-muted">
              {t('band', { band: t(`bands.${budget.budgetBand}`) })}
            </p>
            {budget.withinBudget === true ? (
              <p className="text-sm text-success">{t('within')}</p>
            ) : over !== null ? (
              <p className="text-sm text-pretty text-ink-muted">{t('over', { amount: over })}</p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
