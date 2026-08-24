'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { useTrayJob, useTryOnTrayActions } from '@repo/store';
import { Button, Callout, ShortlistingCaption } from '@repo/ui';

import { cancelTryOnJob } from '@/features/tryon/api/endpoints';
import { StagedProgress } from '@/features/tryon/components/StagedProgress';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { useTryOnJob } from '@/features/tryon/hooks/use-tryon-job';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';

const SLOW_AFTER_MS = 75_000;

export interface InlineTryOnProgressProps {
  jobId: string;
  onSucceeded: (resultId: string) => void;
  onFailed: (errorCode: string) => void;
  onCancelled: () => void;
}

export function InlineTryOnProgress({
  jobId,
  onSucceeded,
  onFailed,
  onCancelled,
}: InlineTryOnProgressProps) {
  const t = useTranslations('tryon.wait');
  const messageFor = useErrorMessage('tryon');
  const { markSeen } = useTryOnTrayActions();

  const trayJob = useTrayJob(jobId);
  const [fallbackStartedAt] = useState(() => Date.now());
  const startedAt = trayJob?.startedAt ?? fallbackStartedAt;

  const progress = useTryOnJob(jobId, startedAt);

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelErrorCode, setCancelErrorCode] = useState<string | null>(null);

  const handedOverRef = useRef(false);

  useEffect(() => {
    if (handedOverRef.current) return;

    if (progress.status === 'SUCCEEDED' && progress.resultId !== null) {
      handedOverRef.current = true;
      markSeen(jobId);
      onSucceeded(progress.resultId);
      return;
    }
    if (progress.status === 'FAILED' && progress.errorCode !== null) {
      handedOverRef.current = true;
      onFailed(progress.errorCode);
      return;
    }
    if (progress.status === 'CANCELLED') {
      handedOverRef.current = true;
      onCancelled();
    }
  }, [
    jobId,
    markSeen,
    onCancelled,
    onFailed,
    onSucceeded,
    progress.errorCode,
    progress.resultId,
    progress.status,
  ]);

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

  const succeeded = progress.status === 'SUCCEEDED';
  const isSlow = progress.elapsedMs > SLOW_AFTER_MS && !succeeded;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-muted">
        {t('elapsed', { seconds: Math.floor(progress.elapsedMs / 1000) })}
      </p>

      <StagedProgress stage={progress.stage} elapsedMs={progress.elapsedMs} complete={succeeded} />

      {isSlow ? (
        <Callout tone="info" title={t('slow.title')}>
          {t('slow.body')}
        </Callout>
      ) : null}

      {cancelErrorCode !== null ? (
        <Callout tone="warning">{messageFor(cancelErrorCode)}</Callout>
      ) : null}

      <ShortlistingCaption>{t('caption')}</ShortlistingCaption>

      {succeeded ? null : (
        <>
          <p className="text-sm text-ink-muted">{t('keepBrowsingNote')}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={cancel}
            loading={isCancelling}
            loadingLabel={t('cancelling')}
          >
            {t('cancel')}
          </Button>
        </>
      )}
    </div>
  );
}
