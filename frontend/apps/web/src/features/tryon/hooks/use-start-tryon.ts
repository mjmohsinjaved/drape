'use client';

import { useCallback, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useQueryClient } from '@tanstack/react-query';

import { isApiError, queryKeys } from '@repo/api-client';
import { useTryOnTrayActions } from '@repo/store';

import { newIdempotencyKey, startTryOn } from '@/features/tryon/api/endpoints';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { TryOnJob } from '@/features/tryon/api/types';
import type { Locale } from '@/i18n/config';

export interface StartTryOnInput {
  garmentId: string;
  garmentTitle: string;
  garmentThumbnailUrl?: string | null;
  personPhotoId?: string;
}

export interface UseStartTryOnResult {
  start: (input: StartTryOnInput) => void;
  isStarting: boolean;
  /** An `ErrorCode`, never a message. The caller maps it through its own i18n namespace. */
  errorCode: string | null;
  /**
   * The job now running, when `stayOnPage` is set. The caller renders the wait against it in
   * place, rather than being sent to `/tryon/:jobId`. Always `null` otherwise.
   */
  jobId: string | null;
  /** Drops the in-place job once the caller has revealed the result or shown the failure. */
  clearJob: () => void;
  reset: () => void;
}

export interface UseStartTryOnOptions {
  locale: Locale;
  /** Where to come back to after signing in, granting consent or adding a photo. */
  returnTo: string;
  /** True when there is no session at all — then the button is a sign-in prompt, not a call. */
  isAuthenticated: boolean;
  /**
   * Keep her where she is. The wait and the reveal both happen on the calling screen: the job
   * id comes back through `jobId` instead of a `router.push` to `/tryon/:jobId`, and a cache
   * hit calls {@link UseStartTryOnOptions.onSucceeded} instead of pushing to the render.
   *
   * This is what the garment page uses (C-18). The try-on is an action *on* the piece she is
   * looking at, so leaving the piece to watch a progress bar — and landing on a third screen
   * afterwards — costs her the context she started with. C-19 is unaffected: the job is still
   * in the tray, so she can walk away from it and it will still find her.
   */
  stayOnPage?: boolean;
  /** Only fires under `stayOnPage`, and only for a cache hit — the render already exists. */
  onSucceeded?: (resultId: string) => void;
}

/**
 * Starting a try-on — PRD §8.1 step 1, C-19.
 *
 * **Nothing is pre-checked in the browser.** The web service holds no business rules (B-2): it
 * posts `{ garmentId, idempotencyKey }` and lets the API's guard chain answer. A refusal comes
 * back as an `ErrorCode`, and the codes that have a *next screen* rather than a retry are
 * routed here — consent to `/consent`, a missing photo to `/photos/new`. Quota and budget
 * exhaustion are handed back to the caller, which composes them into the C-19 panel that offers
 * the shortlist and the enquiry rather than a dead end (§10.3).
 *
 * A cache hit returns the render inside the POST response (§8.1 step 4), so she goes straight to
 * the result and no quota is consumed (C-22). A miss goes to the staged wait — on the calling
 * screen under `stayOnPage`, otherwise at `/tryon/:jobId`.
 */
export function useStartTryOn({
  locale,
  returnTo,
  isAuthenticated,
  stayOnPage = false,
  onSucceeded,
}: UseStartTryOnOptions): UseStartTryOnResult {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { startJob, completeJob } = useTryOnTrayActions();

  const [isStarting, setIsStarting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  // Kept in a ref so a caller that rebuilds the callback every render does not rebuild `start`,
  // which would drop the idempotency key held across a retry of the same tap.
  const succeededRef = useRef(onSucceeded);
  succeededRef.current = onSucceeded;
  // One key per intent. Held across a retry of the same tap so a flaky network cannot charge
  // twice; regenerated once the intent has resolved.
  const keyRef = useRef<string | null>(null);

  const reset = useCallback((): void => {
    setErrorCode(null);
  }, []);

  const clearJob = useCallback((): void => {
    setJobId(null);
  }, []);

  const start = useCallback(
    (input: StartTryOnInput): void => {
      if (!isAuthenticated) {
        router.push(`${routes.login(locale)}?from=${encodeURIComponent(returnTo)}`);
        return;
      }

      setErrorCode(null);
      setJobId(null);
      setIsStarting(true);
      keyRef.current ??= newIdempotencyKey();

      void (async () => {
        try {
          const job: TryOnJob = await startTryOn({
            garmentId: input.garmentId,
            personPhotoId: input.personPhotoId,
            idempotencyKey: keyRef.current ?? newIdempotencyKey(),
          });

          keyRef.current = null;

          startJob({
            jobId: job.jobId,
            garmentId: input.garmentId,
            garmentTitle: input.garmentTitle,
            garmentThumbnailUrl: input.garmentThumbnailUrl ?? null,
            personPhotoId: input.personPhotoId ?? null,
          });

          // The counter changes on every charged generation, so it is refetched rather than
          // guessed at. A cache hit charges nothing, but asking is cheaper than being wrong.
          void queryClient.invalidateQueries({ queryKey: queryKeys.quota.me() });

          if (job.result !== null) {
            completeJob({
              jobId: job.jobId,
              resultId: job.result.id,
              thumbnailUrl: job.result.thumbnailUrl,
              cacheHit: job.cacheHit,
            });
            if (stayOnPage) {
              succeededRef.current?.(job.result.id);
              return;
            }
            router.push(routes.render(locale, job.result.id));
            return;
          }

          if (stayOnPage) {
            setJobId(job.jobId);
            return;
          }

          router.push(routes.tryOnJob(locale, job.jobId));
        } catch (error: unknown) {
          const code = resolveErrorCode(error);

          // The two refusals that are a different screen, not an error. `details.jobId` on
          // IDEMPOTENCY_IN_FLIGHT names the job already running — attach to it rather than
          // asking her to start again (§5.11).
          if (code === 'CONSENT_REQUIRED' || code === 'CONSENT_STALE') {
            router.push(`${routes.consent(locale)}?from=${encodeURIComponent(returnTo)}`);
            return;
          }
          if (code === 'PHOTO_NOT_FOUND' || code === 'PHOTO_NOT_OWNED') {
            router.push(`${routes.photoNew(locale)}?from=${encodeURIComponent(returnTo)}`);
            return;
          }
          if (code === 'IDEMPOTENCY_IN_FLIGHT' && isApiError(error)) {
            const runningJobId = error.details?.jobId;
            if (typeof runningJobId === 'string') {
              if (stayOnPage) {
                setJobId(runningJobId);
                return;
              }
              router.push(routes.tryOnJob(locale, runningJobId));
              return;
            }
          }

          keyRef.current = null;
          setErrorCode(code);
        } finally {
          setIsStarting(false);
        }
      })();
    },
    [completeJob, isAuthenticated, locale, queryClient, returnTo, router, startJob, stayOnPage],
  );

  return { start, isStarting, errorCode, jobId, clearJob, reset };
}
