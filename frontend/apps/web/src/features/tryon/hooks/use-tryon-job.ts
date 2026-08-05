'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { queryKeys, useEventSource } from '@repo/api-client';
import { useTryOnTrayActions } from '@repo/store';

import { getTryOnJob, tryOnStreamUrl } from '@/features/tryon/api/endpoints';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';

import type {
  FailedEvent,
  StageEvent,
  SucceededEvent,
  TryOnStage,
} from '@/features/tryon/api/types';

/** What the wait screen renders from. Everything else about the job is in the tray store. */
export interface TryOnJobProgress {
  stage: TryOnStage;
  elapsedMs: number;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  resultId: string | null;
  errorCode: string | null;
  /** True once the connection has fallen back to polling, so the UI can stay honest. */
  isPolling: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const STAGES: readonly TryOnStage[] = ['QUEUED', 'UPLOADING', 'GENERATING', 'FINISHING'];

function asStage(value: unknown): TryOnStage | null {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
    ? (value as TryOnStage)
    : null;
}

/**
 * The live job — ARCHITECTURE §5.11, PRD C-19 and §10.3.
 *
 * Progress is driven by SSE with the package's 3-second polling fallback: `useEventSource`
 * reconnects with backoff, and once it gives up the `poll` below reads
 * `GET /tryon/jobs/:jobId`, which is correct however long ago the job finished. Either path
 * ends in exactly one terminal transition.
 *
 * **Every transition is written to the tray store as well as to local state**, because C-19
 * says she can navigate away mid-generation: the tray is what tells her the result landed on
 * whatever screen she happens to be on, and it survives a reload through `sessionStorage`.
 *
 * `startedAt` is passed in rather than read from the clock on mount, so the elapsed counter is
 * still right after she comes back to the wait screen from somewhere else.
 */
export function useTryOnJob(jobId: string, startedAt: number): TryOnJobProgress {
  const queryClient = useQueryClient();
  const { updateStage, completeJob, failJob, cancelJob } = useTryOnTrayActions();

  const [stage, setStage] = useState<TryOnStage>('QUEUED');
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAt));
  const [status, setStatus] = useState<TryOnJobProgress['status']>('RUNNING');
  const [resultId, setResultId] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const settledRef = useRef(false);

  /** The elapsed clock. One second is the coarsest tick that still reads as progress. */
  useEffect(() => {
    if (status !== 'RUNNING') return;
    const timer = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [startedAt, status]);

  const settleSucceeded = useCallback(
    (payload: { resultId: string; thumbnailUrl: string | null; cacheHit: boolean }): void => {
      if (settledRef.current) return;
      settledRef.current = true;

      setStatus('SUCCEEDED');
      setStage('FINISHING');
      setResultId(payload.resultId);
      completeJob({
        jobId,
        resultId: payload.resultId,
        thumbnailUrl: payload.thumbnailUrl,
        cacheHit: payload.cacheHit,
      });

      // A new render changes both her history and her counter. Narrowest keys only (§6.4).
      void queryClient.invalidateQueries({ queryKey: queryKeys.results.lists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.quota.me() });
    },
    [completeJob, jobId, queryClient],
  );

  const settleFailed = useCallback(
    (code: string, message: string): void => {
      if (settledRef.current) return;
      settledRef.current = true;

      if (code === 'CANCELLED') {
        setStatus('CANCELLED');
        setErrorCode('CANCELLED');
        cancelJob(jobId);
        return;
      }

      setStatus('FAILED');
      setErrorCode(code);
      failJob({ jobId, errorCode: code, errorMessage: message });
    },
    [cancelJob, failJob, jobId],
  );

  /** The §5.11 fallback. Resolves `true` once the row is terminal so the poller stops. */
  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const job = await getTryOnJob(jobId);

      if (job.status === 'SUCCEEDED' && job.result !== null) {
        settleSucceeded({
          resultId: job.result.id,
          thumbnailUrl: job.result.thumbnailUrl,
          cacheHit: job.cacheHit,
        });
        return true;
      }
      if (job.status === 'FAILED') {
        settleFailed(job.errorCode ?? 'INTERNAL_ERROR', job.message ?? '');
        return true;
      }
      if (job.status === 'CANCELLED') {
        settleFailed('CANCELLED', '');
        return true;
      }
      return false;
    } catch (error: unknown) {
      const code = resolveErrorCode(error);
      // A job that is genuinely gone will never become terminal. Anything else is transient
      // and the next tick tries again.
      if (code === 'JOB_NOT_FOUND') {
        settleFailed(code, '');
        return true;
      }
      return false;
    }
  }, [jobId, settleFailed, settleSucceeded]);

  useEventSource({
    url: tryOnStreamUrl(jobId),
    events: ['stage', 'succeeded', 'failed', 'heartbeat'],
    withCredentials: true,
    poll,
    onStatusChange: (next) => {
      setIsPolling(next === 'polling');
    },
    isTerminal: (event) => event.name === 'succeeded' || event.name === 'failed',
    onEvent: (event) => {
      if (!isRecord(event.data)) return;

      if (event.name === 'stage') {
        const data = event.data as unknown as StageEvent;
        const next = asStage(data.stage);
        if (next === null) return;
        setStage(next);
        setElapsedMs(data.elapsedMs);
        updateStage(jobId, next);
        return;
      }

      if (event.name === 'succeeded') {
        const data = event.data as unknown as SucceededEvent;
        settleSucceeded({
          resultId: data.resultId,
          thumbnailUrl: data.thumbnailUrl,
          cacheHit: data.cacheHit,
        });
        return;
      }

      if (event.name === 'failed') {
        const data = event.data as unknown as FailedEvent;
        settleFailed(data.errorCode, data.message);
      }
    },
  });

  return { stage, elapsedMs, status, resultId, errorCode, isPolling };
}
