'use client';

import { useCallback, useId, useState } from 'react';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Button, Callout, Checkbox, Label } from '@repo/ui';

import { grantConsent } from '@/features/consent/api/endpoints';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { apiLocale ,type  Locale } from '@/i18n/config';
import { useRouter } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

import type { PolicyDocument } from '@/features/consent/api/types';

export interface ConsentGateProps {
  locale: Locale;
  policy: PolicyDocument;
  /** Set when she has agreed to an older version and the policy has moved on (C-12). */
  previousVersion?: string | null;
  /** Where she was heading when the gate interrupted her. Defaults to adding a photo. */
  returnTo?: string;
}

/**
 * The consent gate — PRD C-11, C-12, §10.3.
 *
 * Every rule in §10.3's row for this screen is structural here, not decorative:
 *
 * - **Nothing pre-checked.** The checkbox starts `false` and there is no `defaultChecked`
 *   anywhere in this file. The API refuses a payload without `accepted: true`, so a client that
 *   skipped the gate cannot record agreement either.
 * - **Not skippable.** There is no "remind me later" and no dismiss. The alternative offered is
 *   honest and complete: keep browsing, which genuinely works without a photo (C-1).
 * - **No dark patterns, no visual pressure.** Agree and "not now" are a primary and a ghost
 *   button of the same size, side by side, with no colour, motion or wording pushing either way.
 *   The decline is not a grey whisper at the bottom of the page.
 * - **Generous spacing.** `--space-8` between statements, a prose measure, and one idea per
 *   block — this screen is read, not scanned.
 *
 * The five C-11 statements are rendered as headed blocks rather than buried in the policy body,
 * because a summary she reads beats a document she scrolls past. The full policy is one
 * disclosure away and is the same text the API served.
 */
export function ConsentGate({ locale, policy, previousVersion, returnTo }: ConsentGateProps) {
  const t = useTranslations('consent.gate');
  const messageFor = useErrorMessage('consent');
  const router = useRouter();

  const checkboxId = useId();
  const hintId = useId();
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const isStale = previousVersion !== null && previousVersion !== undefined;
  const destination = returnTo ?? routes.photoNew(locale);

  const submit = useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (!accepted) return;

      setIsSubmitting(true);
      setErrorCode(null);

      void grantConsent({
        policyVersion: policy.version,
        accepted: true,
        locale: apiLocale[locale],
      })
        .then(() => {
          router.push(destination);
        })
        .catch((error: unknown) => {
          setErrorCode(resolveErrorCode(error));
        })
        .finally(() => {
          setIsSubmitting(false);
        });
    },
    [accepted, destination, locale, policy.version, router],
  );

  const retention = policy.retentionSummary;

  return (
    <div className="mx-auto flex w-full max-w-prose flex-col gap-12 py-4">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">{t('eyebrow')}</p>
        <h1 className="font-display text-3xl text-balance md:text-4xl">
          {isStale ? t('staleTitle') : t('title')}
        </h1>
        <p className="text-pretty text-ink-muted">
          {isStale
            ? t('staleIntro', { previous: previousVersion, current: policy.version })
            : t('intro')}
        </p>
      </header>

      <div className="flex flex-col gap-8">
        <Statement title={t('points.purposeTitle')} body={t('points.purposeBody')} />
        <Statement title={t('points.providerTitle')} body={t('points.providerBody')} />
        <Statement
          title={t('points.retentionTitle', { photoDays: retention.photoDays })}
          body={t('points.retentionBody')}
          extra={
            retention.rendersLifetime
              ? t('points.retentionRendersLifetime')
              : t('points.retentionRendersLimited')
          }
        />
        <Statement title={t('points.staffTitle')} body={t('points.staffBody')} />
        <Statement title={t('points.controlTitle')} body={t('points.controlBody')} />
      </div>

      {/*
        The summary and the full text the API served, verbatim. Rendered as text rather than
        parsed as HTML: this is a legal document and it must reach her exactly as written.
      */}
      <details className="rounded-lg border border-line bg-surface-sunken p-4">
        <summary className="min-h-11 cursor-pointer list-none text-sm font-medium underline underline-offset-4">
          {t('fullPolicy')}
        </summary>
        <div className="flex flex-col gap-4 pt-4">
          <p className="text-sm text-ink-muted">{policy.summary}</p>
          <p className="whitespace-pre-wrap text-sm text-pretty">{policy.body}</p>
        </div>
      </details>

      <form onSubmit={submit} className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-3">
            <Checkbox
              id={checkboxId}
              checked={accepted}
              aria-describedby={hintId}
              onCheckedChange={(next) => {
                setAccepted(next === true);
              }}
            />
            <Label htmlFor={checkboxId} className="text-pretty leading-normal">
              {t('checkboxLabel')}
            </Label>
          </div>
          <p id={hintId} className="ps-8 text-sm text-ink-subtle">
            {t('checkboxHint')}
          </p>
        </div>

        {errorCode !== null ? <Callout tone="danger">{messageFor(errorCode)}</Callout> : null}

        {/*
          One row, two equally sized controls. Agree is primary because it is the action she came
          here to take, not because the interface wants her to take it — the decline is the same
          height, the same weight of type and sits immediately beside it (§10.3).
        */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={!accepted}
            loading={isSubmitting}
            loadingLabel={t('submitting')}
            className="sm:flex-1"
          >
            {isStale ? t('acceptStale') : t('accept')}
          </Button>

          <Button asChild variant="secondary" size="lg" className="sm:flex-1">
            <Link href={routes.browse(locale)}>{t('decline')}</Link>
          </Button>
        </div>

        <p className="text-sm text-ink-muted">{t('declineNote')}</p>

        <p className="text-xs text-ink-subtle">
          {t('versionLabel', { version: policy.version })}
        </p>
      </form>
    </div>
  );
}

function Statement({ title, body, extra }: { title: string; body: string; extra?: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium text-balance">{title}</h2>
      <p className="text-pretty text-ink-muted">{body}</p>
      {extra === undefined ? null : <p className="text-pretty text-ink-muted">{extra}</p>}
    </section>
  );
}
