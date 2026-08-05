/**
 * The results tray — PRD C-19, ARCHITECTURE.md §6.5 (`useTryOnStore`).
 *
 * A try-on takes about seven seconds. C-19 says she keeps browsing during it and collects the
 * results in a tray, so the in-flight jobs and the finished results have to outlive the screen
 * that started them — and a reload, which is why this store persists to **`sessionStorage`**. It
 * is deliberately not `localStorage`: a tray from last Tuesday is noise, and the signed render
 * URLs in it would have expired anyway (`STORAGE_URL_TTL_RENDER_SECONDS`).
 *
 * This store holds *progress*, not results data. The render itself is server state and lives in
 * TanStack Query under `queryKeys.results.detail(id)`; what is kept here is the id, the stage and
 * enough garment identity to render a tray row without a second fetch. **A `fetch` inside a store
 * is a review failure** (§6.5).
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';


import { devtoolsOptions } from '../middleware/devtools.middleware';
import {
  PERSIST_KEYS,
  createPersistOptions,
  sessionJsonStorage,
} from '../middleware/persist.middleware';

import type { JobStatus, TryOnStage } from '@repo/api-client';

/** One row of the tray. */
export interface TrayJob {
  jobId: string;
  garmentId: string;
  /** Enough identity to render the row while the job runs, without joining the catalog again. */
  garmentTitle: string;
  garmentThumbnailUrl: string | null;
  personPhotoId: string | null;
  status: JobStatus;
  stage: TryOnStage;
  /** Epoch ms. Drives the staged microcopy and the "taking longer than usual" copy (§10.3). */
  startedAt: number;
  finishedAt: number | null;
  /** Set once the job succeeds; the tray links to `queryKeys.results.detail(resultId)`. */
  resultId: string | null;
  thumbnailUrl: string | null;
  /**
   * An §2.4 `ErrorCode` value on a failed job. **This is what the tray renders from**, through
   * `useErrorCopy('tryon.errors')`.
   */
  errorCode: string | null;
  /**
   * The §8.3 consumer copy the API sent alongside the code. Kept for diagnostics, **not
   * displayed**: it is English only and the app is bilingual (C-41). See the note on `ApiError`
   * in `@repo/api-client`.
   */
  errorMessage: string | null;
  cacheHit: boolean;
  /** True once she has seen it, so the unseen badge can be honest. */
  seen: boolean;
}

export interface StartJobInput {
  jobId: string;
  garmentId: string;
  garmentTitle: string;
  garmentThumbnailUrl?: string | null;
  personPhotoId?: string | null;
  /** Injectable for deterministic tests. */
  startedAt?: number;
}

export interface CompleteJobInput {
  jobId: string;
  resultId: string;
  thumbnailUrl?: string | null;
  cacheHit?: boolean;
  finishedAt?: number;
}

export interface FailJobInput {
  jobId: string;
  errorCode: string;
  errorMessage: string;
  finishedAt?: number;
}

export interface TryOnTrayState {
  jobs: Record<string, TrayJob>;
  trayOpen: boolean;
  /** The photo the next try-on will use. Mirrors `person_photos.isActive` for the picker (C-16). */
  activePhotoId: string | null;

  startJob: (input: StartJobInput) => void;
  updateStage: (jobId: string, stage: TryOnStage) => void;
  completeJob: (input: CompleteJobInput) => void;
  failJob: (input: FailJobInput) => void;
  cancelJob: (jobId: string, finishedAt?: number) => void;
  dismissJob: (jobId: string) => void;
  markSeen: (jobId: string) => void;
  markAllSeen: () => void;
  clearFinished: () => void;
  setTrayOpen: (open: boolean) => void;
  toggleTray: () => void;
  setActivePhotoId: (photoId: string | null) => void;
  reset: () => void;
}

const initialState = {
  jobs: {},
  trayOpen: false,
  activePhotoId: null,
} satisfies Pick<TryOnTrayState, 'jobs' | 'trayOpen' | 'activePhotoId'>;

export interface PersistedTrayState {
  jobs: Record<string, TrayJob>;
  activePhotoId: string | null;
}

/** Bump on any change to {@link TrayJob} or {@link PersistedTrayState}. */
export const TRAY_PERSIST_VERSION = 1;

/**
 * Rehydration is deliberately lossy. A tray row from a previous session carries a signed URL that
 * has almost certainly expired, and a job that was `RUNNING` when the tab closed has no stream to
 * reattach to. Anything unrecognisable is dropped rather than repaired.
 */
export function migrateTrayState(persisted: unknown, fromVersion: number): PersistedTrayState {
  const empty: PersistedTrayState = { jobs: {}, activePhotoId: null };

  if (fromVersion > TRAY_PERSIST_VERSION) return empty;
  if (typeof persisted !== 'object' || persisted === null) return empty;

  const candidate = persisted as Record<string, unknown>;
  const rawJobs = candidate.jobs;
  if (typeof rawJobs !== 'object' || rawJobs === null) return empty;

  const jobs: Record<string, TrayJob> = {};
  for (const [jobId, value] of Object.entries(rawJobs as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const job = value as Partial<TrayJob>;
    if (typeof job.jobId !== 'string' || typeof job.garmentId !== 'string') continue;
    jobs[jobId] = job as TrayJob;
  }

  return {
    jobs,
    activePhotoId: typeof candidate.activePhotoId === 'string' ? candidate.activePhotoId : null,
  };
}

function patchJob(
  jobs: Record<string, TrayJob>,
  jobId: string,
  patch: Partial<TrayJob>,
): Record<string, TrayJob> {
  const existing = jobs[jobId];
  if (existing === undefined) return jobs;
  return { ...jobs, [jobId]: { ...existing, ...patch } };
}

export const useTryOnTrayStore = create<TryOnTrayState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        startJob: ({ jobId, garmentId, garmentTitle, garmentThumbnailUrl, personPhotoId, startedAt }) =>
          set(
            (state) => ({
              jobs: {
                ...state.jobs,
                [jobId]: {
                  jobId,
                  garmentId,
                  garmentTitle,
                  garmentThumbnailUrl: garmentThumbnailUrl ?? null,
                  personPhotoId: personPhotoId ?? null,
                  status: 'QUEUED',
                  stage: 'QUEUED',
                  startedAt: startedAt ?? Date.now(),
                  finishedAt: null,
                  resultId: null,
                  thumbnailUrl: null,
                  errorCode: null,
                  errorMessage: null,
                  cacheHit: false,
                  seen: false,
                },
              },
            }),
            false,
            'tryOnTray/startJob',
          ),

        updateStage: (jobId, stage) =>
          set(
            (state) => ({ jobs: patchJob(state.jobs, jobId, { stage, status: 'RUNNING' }) }),
            false,
            'tryOnTray/updateStage',
          ),

        completeJob: ({ jobId, resultId, thumbnailUrl, cacheHit, finishedAt }) =>
          set(
            (state) => ({
              jobs: patchJob(state.jobs, jobId, {
                status: 'SUCCEEDED',
                stage: 'FINISHING',
                resultId,
                thumbnailUrl: thumbnailUrl ?? null,
                cacheHit: cacheHit ?? false,
                finishedAt: finishedAt ?? Date.now(),
                errorCode: null,
                errorMessage: null,
                seen: false,
              }),
            }),
            false,
            'tryOnTray/completeJob',
          ),

        failJob: ({ jobId, errorCode, errorMessage, finishedAt }) =>
          set(
            (state) => ({
              jobs: patchJob(state.jobs, jobId, {
                status: 'FAILED',
                errorCode,
                errorMessage,
                finishedAt: finishedAt ?? Date.now(),
                seen: false,
              }),
            }),
            false,
            'tryOnTray/failJob',
          ),

        cancelJob: (jobId, finishedAt) =>
          set(
            (state) => ({
              jobs: patchJob(state.jobs, jobId, {
                status: 'CANCELLED',
                finishedAt: finishedAt ?? Date.now(),
                seen: true,
              }),
            }),
            false,
            'tryOnTray/cancelJob',
          ),

        dismissJob: (jobId) =>
          set(
            (state) => {
              if (state.jobs[jobId] === undefined) return state;
              const next = { ...state.jobs };
              delete next[jobId];
              return { jobs: next };
            },
            false,
            'tryOnTray/dismissJob',
          ),

        markSeen: (jobId) =>
          set(
            (state) => ({ jobs: patchJob(state.jobs, jobId, { seen: true }) }),
            false,
            'tryOnTray/markSeen',
          ),

        markAllSeen: () =>
          set(
            (state) => ({
              jobs: Object.fromEntries(
                Object.entries(state.jobs).map(([id, job]) => [id, { ...job, seen: true }]),
              ),
            }),
            false,
            'tryOnTray/markAllSeen',
          ),

        clearFinished: () =>
          set(
            (state) => ({
              jobs: Object.fromEntries(
                Object.entries(state.jobs).filter(([, job]) => isJobActive(job)),
              ),
            }),
            false,
            'tryOnTray/clearFinished',
          ),

        setTrayOpen: (trayOpen) => set({ trayOpen }, false, 'tryOnTray/setTrayOpen'),

        toggleTray: () =>
          set((state) => ({ trayOpen: !state.trayOpen }), false, 'tryOnTray/toggleTray'),

        setActivePhotoId: (activePhotoId) =>
          set({ activePhotoId }, false, 'tryOnTray/setActivePhotoId'),

        reset: () => set({ ...initialState }, false, 'tryOnTray/reset'),
      }),
      createPersistOptions<TryOnTrayState, PersistedTrayState>({
        name: PERSIST_KEYS.tryOnTray,
        version: TRAY_PERSIST_VERSION,
        storage: sessionJsonStorage<PersistedTrayState>(),
        // `trayOpen` is transient: reopening a panel on reload is jarring.
        partialize: (state) => ({ jobs: state.jobs, activePhotoId: state.activePhotoId }),
        migrate: migrateTrayState,
      }),
    ),
    devtoolsOptions('tryon-tray'),
  ),
);

/** True while the job is still going — the tray shows a progress row rather than a result. */
export function isJobActive(job: TrayJob): boolean {
  return job.status === 'QUEUED' || job.status === 'RUNNING';
}

/* ------------------------------------------------------------------- selectors */

export const selectTrayOpen = (state: TryOnTrayState): boolean => state.trayOpen;

export const selectTrayActivePhotoId = (state: TryOnTrayState): string | null =>
  state.activePhotoId;

export const selectTrayJob =
  (jobId: string) =>
  (state: TryOnTrayState): TrayJob | undefined =>
    state.jobs[jobId];

/** Count only — the badge re-renders on a count change, not on every stage tick. */
export const selectTrayActiveCount = (state: TryOnTrayState): number =>
  Object.values(state.jobs).filter(isJobActive).length;

export const selectTrayUnseenCount = (state: TryOnTrayState): number =>
  Object.values(state.jobs).filter((job) => !job.seen && !isJobActive(job)).length;

export const selectHasActiveTrayJobs = (state: TryOnTrayState): boolean =>
  Object.values(state.jobs).some(isJobActive);

/** Newest first, so the tray reads the way a feed does. */
export const selectTrayJobsNewestFirst = (state: TryOnTrayState): TrayJob[] =>
  Object.values(state.jobs).sort((a, b) => b.startedAt - a.startedAt);

export const useTrayJob = (jobId: string): TrayJob | undefined =>
  useTryOnTrayStore(selectTrayJob(jobId));

export const useTrayJobIds = (): string[] =>
  useTryOnTrayStore(useShallow((state) => Object.keys(state.jobs)));

export const useTrayJobsNewestFirst = (): TrayJob[] =>
  useTryOnTrayStore(useShallow(selectTrayJobsNewestFirst));

export const useTrayOpen = (): boolean => useTryOnTrayStore(selectTrayOpen);

export const useTrayActivePhotoId = (): string | null =>
  useTryOnTrayStore(selectTrayActivePhotoId);

export const useTrayActiveCount = (): number => useTryOnTrayStore(selectTrayActiveCount);

export const useTrayUnseenCount = (): number => useTryOnTrayStore(selectTrayUnseenCount);

export const useHasActiveTrayJobs = (): boolean => useTryOnTrayStore(selectHasActiveTrayJobs);

export const useTryOnTrayActions = (): Pick<
  TryOnTrayState,
  | 'startJob'
  | 'updateStage'
  | 'completeJob'
  | 'failJob'
  | 'cancelJob'
  | 'dismissJob'
  | 'markSeen'
  | 'markAllSeen'
  | 'clearFinished'
  | 'setTrayOpen'
  | 'toggleTray'
  | 'setActivePhotoId'
> =>
  useTryOnTrayStore(
    useShallow((state) => ({
      startJob: state.startJob,
      updateStage: state.updateStage,
      completeJob: state.completeJob,
      failJob: state.failJob,
      cancelJob: state.cancelJob,
      dismissJob: state.dismissJob,
      markSeen: state.markSeen,
      markAllSeen: state.markAllSeen,
      clearFinished: state.clearFinished,
      setTrayOpen: state.setTrayOpen,
      toggleTray: state.toggleTray,
      setActivePhotoId: state.setActivePhotoId,
    })),
  );
