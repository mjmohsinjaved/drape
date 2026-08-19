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

/** After this long the copy switches to §8.3's "Taking longer than usual — hang tight." */
const SLOW_AFTER_MS = 12_000;

export interface InlineTryOnProgressProps {
  jobId: string;
  /** Fires once, with the render that landed. The caller reveals it in place. */
  onSucceeded: (resultId: string) => void;
  /** Fires once, with an §8.3 `ErrorCode`. The caller owns the copy and the way forward. */
  onFailed: (errorCode: string) => void;
  /** Fires once. Not a failure — she chose it, so the caller simply returns to the CTA. */
  onCancelled: () => void;
}

/**
 * The C-19 wait, rendered where the try-on was started — PRD C-18, C-19, §10.3.
 *
 * Same job, same stream and same staged sequence as `TryOnWaitScreen`; the difference is only
 * where it is drawn. The garment page starts the try-on and shows the result on the piece, so
 * the wait belongs there too: sending her to `/tryon/:jobId` and then to `/renders/:id` puts two
 * navigations between the tap and the answer, and loses the garment she was deciding about.
 *
 * She can still leave — the job is in the tray, the tray survives the route change and a reload,
 * and `useTrayReconciler` settles it wherever she ends up (§5.11). Nothing here is the only
 * place a result can be found.
 */
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
  // A job attached to rather than started here — an `IDEMPOTENCY_IN_FLIGHT` re-tap — has no
  // tray row yet, so the clock starts now and the stream supplies the rest.
  const [fallbackStartedAt] = useState(() => Date.now());
  const startedAt = trayJob?.startedAt ?? fallbackStartedAt;

  const progress = useTryOnJob(jobId, startedAt);

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelErrorCode, setCancelErrorCode] = useState<string | null>(null);

  // One terminal handover per job, whatever re-renders the stream causes.
  const handedOverRef = useRef(false);

  useEffect(() => {
    if (handedOverRef.current) return;

    if (progress.status === 'SUCCEEDED' && progress.resultId !== null) {
      handedOverRef.current = true;
      // She is looking straight at it, so it is not something the tray badge should chase.
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

      <StagedProgress
        stage={progress.stage}
        elapsedMs={progress.elapsedMs}
        complete={succeeded}
      />

      {isSlow ? (
        <Callout tone="info" title={t('slow.title')}>
          {t('slow.body')}
        </Callout>
      ) : null}

      {cancelErrorCode !== null ? (
        <Callout tone="warning">{messageFor(cancelErrorCode)}</Callout>
      ) : null}

      {/* C-20's caption is present from the first second, not held back until the reveal. */}
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
