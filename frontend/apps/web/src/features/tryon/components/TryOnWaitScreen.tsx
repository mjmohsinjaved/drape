'use client';

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface TryOnWaitScreenProps {
  locale: Locale;
  jobId: string;
}

const SLOW_AFTER_MS = 75_000;

export function TryOnWaitScreen({ locale, jobId }: TryOnWaitScreenProps) {
  const t = useTranslations('tryon');
  const messageFor = useErrorMessage('tryon');
  const router = useRouter();
  const { markSeen } = useTryOnTrayActions();

  const trayJob = useTrayJob(jobId);
  const [fallbackStartedAt] = useState(() => Date.now());
  const startedAt = trayJob?.startedAt ?? fallbackStartedAt;

  const progress = useTryOnJob(jobId, startedAt);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelErrorCode, setCancelErrorCode] = useState<string | null>(null);

  const garmentTitle = trayJob?.garmentTitle ?? null;

  useEffect(() => {
    if (progress.status === 'SUCCEEDED' && progress.resultId !== null) {
      markSeen(jobId);
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

      <StagedProgress stage={progress.stage} elapsedMs={progress.elapsedMs} complete={succeeded} />

      {isSlow && !succeeded ? (
        <Callout tone="info" title={t('wait.slow.title')}>
          {t('wait.slow.body')}
        </Callout>
      ) : null}

      {cancelErrorCode !== null ? (
        <Callout tone="warning">{messageFor(cancelErrorCode)}</Callout>
      ) : null}

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

function FailureView({ locale, code, message }: { locale: Locale; code: string; message: string }) {
  const t = useTranslations('tryon');

  if (isQuotaExhausted(code)) return <QuotaExhausted locale={locale} headingLevel="h1" />;
  if (isBudgetExhausted(code)) return <BudgetExhausted locale={locale} headingLevel="h1" />;

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
