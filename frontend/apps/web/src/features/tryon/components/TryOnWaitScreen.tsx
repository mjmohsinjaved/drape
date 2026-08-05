'use client';

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { useTrayJob, useTryOnTrayActions } from '@repo/store';
import { Button, Callout, ShortlistingCaption, SuccessState } from '@repo/ui';

import { cancelTryOnJob } from '@/features/tryon/api/endpoints';
import { QuotaExhausted, BudgetExhausted } from '@/features/tryon/components/QuotaExhausted';
import { StagedProgress } from '@/features/tryon/components/StagedProgress';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { useTryOnJob } from '@/features/tryon/hooks/use-tryon-job';
import {
  isBudgetExhausted,
  isQuotaExhausted,
  isRetryableCode,
  needsAnotherPhoto,
  resolveErrorCode,
} from '@/features/tryon/lib/error-copy';
import { useRouter } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface TryOnWaitScreenProps {
  locale: Locale;
  jobId: string;
}

/** After this long the copy switches to §8.3's "Taking longer than usual — hang tight." */
const SLOW_AFTER_MS = 12_000;

/**
 * The wait and the reveal — PRD C-19, C-20, §10.3.
 *
 * The two things this screen has to get right:
 *
 * 1. **It is a staged, progressing sequence, not a spinner.** `StagedProgress` owns that.
 * 2. **She can leave.** "Keep browsing" is a first-class action, not a hidden escape: the job
 *    keeps running server-side, the tray follows her, and coming back here re-attaches to the
 *    same stream — or replays the terminal event, or polls the row, whichever still applies
 *    (§5.11).
 *
 * On success it hands straight over to the result view rather than drawing a second, lesser
 * version of it. On failure every code in the §8.3 taxonomy resolves to copy plus a way
 * forward, and quota and budget exhaustion get their own composed panels instead of an error.
 */
export function TryOnWaitScreen({ locale, jobId }: TryOnWaitScreenProps) {
  const t = useTranslations('tryon');
  const messageFor = useErrorMessage('tryon');
  const router = useRouter();
  const { markSeen } = useTryOnTrayActions();

  const trayJob = useTrayJob(jobId);
  // A direct hit on `/tryon/:jobId` — a reload, a shared link, a session restored on another
  // device — has no tray row, so the clock starts now and the stream supplies the rest.
  const [fallbackStartedAt] = useState(() => Date.now());
  const startedAt = trayJob?.startedAt ?? fallbackStartedAt;

  const progress = useTryOnJob(jobId, startedAt);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelErrorCode, setCancelErrorCode] = useState<string | null>(null);

  const garmentTitle = trayJob?.garmentTitle ?? null;

  useEffect(() => {
    if (progress.status === 'SUCCEEDED' && progress.resultId !== null) {
      markSeen(jobId);
      // `replace`, not `push`: the wait is a moment, not a destination. Backing out of the
      // result should return her to the piece she was looking at.
      router.replace(routes.render(locale, progress.resultId));
    }
  }, [jobId, locale, markSeen, progress.resultId, progress.status, router]);

  const cancel = useCallback((): void => {
    setIsCancelling(true);
    setCancelErrorCode(null);
    void cancelTryOnJob(jobId)
      .catch((error: unknown) => {
        setCancelErrorCode(resolveErrorCode(error));
      })
      .finally(() => {
        setIsCancelling(false);
      });
  }, [jobId]);

  if (progress.status === 'CANCELLED') {
    return (
      <SuccessState
        title={t('wait.cancelled.title')}
        description={t('wait.cancelled.description')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.browse(locale)}>{t('wait.cancelled.action')}</Link>
          </Button>
        }
      />
    );
  }

  if (progress.status === 'FAILED' && progress.errorCode !== null) {
    return (
      <FailureView
        locale={locale}
        code={progress.errorCode}
        message={messageFor(progress.errorCode)}
      />
    );
  }

  const isSlow = progress.elapsedMs > SLOW_AFTER_MS;
  const succeeded = progress.status === 'SUCCEEDED';

  return (
    <div className="mx-auto flex w-full max-w-prose flex-col gap-8 py-4">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl text-balance md:text-3xl">
          {garmentTitle === null
            ? t('wait.titleGeneric')
            : t('wait.title', { garment: garmentTitle })}
        </h1>
        <p className="text-sm text-ink-muted">
          {t('wait.elapsed', { seconds: Math.floor(progress.elapsedMs / 1000) })}
        </p>
      </header>

      <StagedProgress
        stage={progress.stage}
        elapsedMs={progress.elapsedMs}
        complete={succeeded}
      />

      {isSlow && !succeeded ? (
        <Callout tone="info" title={t('wait.slow.title')}>
          {t('wait.slow.body')}
        </Callout>
      ) : null}

      {cancelErrorCode !== null ? (
        <Callout tone="warning">{messageFor(cancelErrorCode)}</Callout>
      ) : null}

      {/*
        C-20's caption is present from the first second, not held back until the reveal — she
        should know what she is about to be shown before she is shown it.
      */}
      <ShortlistingCaption>{t('wait.caption')}</ShortlistingCaption>

      <div className="flex flex-col gap-3">
        <Button asChild variant="secondary" fullWidth>
          <Link href={routes.browse(locale)}>{t('wait.keepBrowsing')}</Link>
        </Button>
        <p className="text-sm text-ink-muted">{t('wait.keepBrowsingNote')}</p>

        {succeeded ? null : (
          <Button
            type="button"
            variant="ghost"
            onClick={cancel}
            loading={isCancelling}
            loadingLabel={t('wait.cancelling')}
          >
            {t('wait.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Every terminal failure, with a next step attached (D-7, §8.3).
 *
 * Quota and budget are not failures and are never drawn as one. A photo-shaped refusal sends her
 * to the picker rather than offering a retry that would fail identically.
 */
function FailureView({
  locale,
  code,
  message,
}: {
  locale: Locale;
  code: string;
  message: string;
}) {
  const t = useTranslations('tryon');

  if (isQuotaExhausted(code)) return <QuotaExhausted locale={locale} />;
  if (isBudgetExhausted(code)) return <BudgetExhausted locale={locale} />;

  return (
    <div className="mx-auto flex w-full max-w-prose flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl text-balance">{t('failed.title')}</h1>
        <p className="text-ink-muted">{message}</p>
        <p className="text-sm text-ink-subtle">{t('failed.noCharge')}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        {needsAnotherPhoto(code) ? (
          <Button asChild variant="primary">
            <Link href={routes.photoNew(locale)}>{t('start.needsPhoto')}</Link>
          </Button>
        ) : null}

        <Button asChild variant={needsAnotherPhoto(code) ? 'secondary' : 'primary'}>
          <Link href={routes.browse(locale)}>{t('failed.browse')}</Link>
        </Button>

        {isRetryableCode(code) ? (
          <Button asChild variant="ghost">
            <Link href={routes.shortlist(locale)}>{t('failed.shortlist')}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
