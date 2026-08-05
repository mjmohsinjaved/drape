'use client';

import Link from 'next/link';

import { Heart, MessageSquare, Sparkles } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface QuotaExhaustedProps {
  locale: Locale;
  /** ISO instant the next monthly grant lands, from `GET /quota/me`. */
  resetsAt?: string | null;
  /**
   * `h2` when this sits inside a screen that already has an `h1` (the garment page, via
   * `TryOnButton`); `h1` when it replaces the whole screen (`TryOnWaitScreen`). It used to take
   * `CardTitle`'s `h3` default, which left the standalone case with no `h1` on the page at all
   * and made the inline case jump a level (D-20).
   */
  headingLevel?: 'h1' | 'h2';
}

/**
 * Quota exhaustion — PRD §8.3 and §10.3.
 *
 * > "Presents the shortlist and the enquiry action, never a dead end."
 *
 * So this is a composed screen, not an error state: it has no retry, no apology and no
 * dismissal. Three things she can do right now sit on it, in the order they are worth doing —
 * her shortlist is saved, an enquiry can go tonight, and every try-on she already has costs
 * nothing to reopen (C-26).
 */
export function QuotaExhausted({ locale, resetsAt, headingLevel = 'h2' }: QuotaExhaustedProps) {
  const t = useTranslations('tryon.quota.exhausted');
  const format = useFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle as={headingLevel}>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button asChild variant="primary" startIcon={<Heart aria-hidden="true" />}>
            <Link href={routes.shortlist(locale)}>{t('shortlist')}</Link>
          </Button>
          <Button asChild variant="secondary" startIcon={<MessageSquare aria-hidden="true" />}>
            <Link href={routes.enquiryNew(locale)}>{t('enquire')}</Link>
          </Button>
          <Button asChild variant="ghost" startIcon={<Sparkles aria-hidden="true" />}>
            <Link href={routes.renders(locale)}>{t('renders')}</Link>
          </Button>
        </div>

        {resetsAt ? (
          <p className="text-sm text-ink-muted">
            {t('resets', { date: format.dateTime(new Date(resetsAt), 'short') })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export interface BudgetExhaustedProps {
  locale: Locale;
  /** See `QuotaExhaustedProps.headingLevel`. */
  headingLevel?: 'h1' | 'h2';
}

/**
 * System budget exhaustion — §8.3's "Our fitting room is at capacity today". Same rule: the
 * catalog stays browsable and her shortlist is where she left it, so both are offered here.
 */
export function BudgetExhausted({ locale, headingLevel = 'h2' }: BudgetExhaustedProps) {
  const t = useTranslations('tryon.budget');

  return (
    <Card>
      <CardHeader>
        <CardTitle as={headingLevel}>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row">
        <Button asChild variant="primary">
          <Link href={routes.shortlist(locale)}>{t('shortlist')}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={routes.browse(locale)}>{t('browse')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
