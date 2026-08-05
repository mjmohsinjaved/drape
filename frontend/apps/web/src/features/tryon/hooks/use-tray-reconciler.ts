'use client';

import { useEffect, useRef } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@repo/api-client';
import { useActiveTrayJobIds, useTryOnTrayActions } from '@repo/store';

import { getTryOnJob } from '@/features/tryon/api/endpoints';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';

/** §6.4 — "a 3 s polling fallback when `EventSource` fails". The tray uses the same cadence. */
export const TRAY_RECONCILE_INTERVAL_MS = 3_000;

/**
 * The tray reconciles its own rows — PRD C-19.
 *
 * > "She can keep browsing; results collect in a tray and notify inline."
 *
 * That promise has an owner problem. Terminal state used to be written **only** by
 * `useTryOnJob`, and `useTryOnJob` is mounted only by `TryOnWaitScreen`; `useEventSource` closes
 * its stream on unmount. So the moment she took "Keep browsing" — an action the wait screen
 * itself offers, first-class, right under the progress bar — the job was stranded: the tray row
 * span forever, `announceReady` never fired, and `queryKeys.results.lists()` was never
 * invalidated, so the render was missing from her history too. A second concurrent try-on had
 * the same problem, and so did every row restored from `sessionStorage` after a reload.
 *
 * The fix is a matter of which component owns the question. **The tray does**, because the tray
 * is what follows her across the browse surface. This hook polls `GET /tryon/jobs/:jobId` — the
 * route §5.11 names as the SSE fallback, and which is correct however long ago the job finished —
 * for every active row, and writes each answer through `completeJob` / `failJob` / `cancelJob`.
 * The wait screen keeps its stream, because a staged progress bar needs per-stage events; it is
 * no longer the only thing that can settle a job.
 *
 * A `fetch` inside a store is a review failure (§6.5), which is why this is a hook next to the
 * tray rather than a subscription inside `useTryOnTrayStore`.
 */
export function useTrayReconciler(): void {
  const queryClient = useQueryClient();
  const activeIds = useActiveTrayJobIds();
  const { completeJob, failJob, cancelJob } = useTryOnTrayActions();

  // The actions are recreated per render by `useShallow`; holding them in a ref keeps the poll
  // loop from being torn down and restarted on every tick it causes.
  const actionsRef = useRef({ completeJob, failJob, cancelJob });
  actionsRef.current = { completeJob, failJob, cancelJob };

  // `useShallow` already makes this array stable by value; the join is what lets the effect
  // depend on the *contents* rather than the identity.
  const key = activeIds.join(',');

  useEffect(() => {
    if (key === '') return;

    const ids = key.split(',');
    const controller = new AbortController();
    let stopped = false;

    const reconcile = async (jobId: string): Promise<void> => {
      const { completeJob: complete, failJob: fail, cancelJob: cancel } = actionsRef.current;

      try {
        const job = await getTryOnJob(jobId, controller.signal);
        if (stopped) return;

        if (job.status === 'SUCCEEDED' && job.result !== null) {
          complete({
            jobId,
            resultId: job.result.id,
            thumbnailUrl: job.result.thumbnailUrl,
            cacheHit: job.cacheHit,
          });
          // A new render changes both her history and her counter. Narrowest keys only (§6.4).
          void queryClient.invalidateQueries({ queryKey: queryKeys.results.lists() });
          void queryClient.invalidateQueries({ queryKey: queryKeys.quota.me() });
          return;
        }

        if (job.status === 'FAILED') {
          fail({ jobId, errorCode: job.errorCode ?? 'INTERNAL_ERROR', errorMessage: job.message ?? '' });
          void queryClient.invalidateQueries({ queryKey: queryKeys.quota.me() });
          return;
        }

        if (job.status === 'CANCELLED') {
          cancel(jobId);
        }

        // Still going: nothing to write. `TryOnJobResponseDto` carries no `stage` — the staged
        // sequence exists on the SSE stream only (see the note in `api/types.ts`) — and the tray
        // row says "in progress" rather than naming a stage, so a poll has nothing to add until
        // the job is terminal.
      } catch (error: unknown) {
        if (stopped) return;
        const code = resolveErrorCode(error);

        // A job that is genuinely gone will never become terminal, and a row that spins forever
        // is the defect this hook exists to remove. Anything else is transient — the next tick
        // tries again, and an aborted request is this effect being cleaned up.
        if (code === 'JOB_NOT_FOUND') {
          actionsRef.current.failJob({ jobId, errorCode: code, errorMessage: '' });
        }
      }
    };

    const tick = (): void => {
      for (const jobId of ids) void reconcile(jobId);
    };

    tick();
    const timer = setInterval(tick, TRAY_RECONCILE_INTERVAL_MS);

    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [key, queryClient]);
}
