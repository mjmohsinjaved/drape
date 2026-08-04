import { beforeEach, describe, expect, it } from 'vitest';

import { PERSIST_KEYS } from '../middleware/persist.middleware';

import {
  TRAY_PERSIST_VERSION,
  type TrayJob,
  type TryOnTrayState,
  isJobActive,
  migrateTrayState,
  selectHasActiveTrayJobs,
  selectTrayActiveCount,
  selectTrayJob,
  selectTrayJobsNewestFirst,
  selectTrayUnseenCount,
  useTryOnTrayStore,
} from './tryon-tray.store';

function state(): TryOnTrayState {
  return useTryOnTrayStore.getState();
}

function start(jobId: string, startedAt = 1_000): void {
  state().startJob({
    jobId,
    garmentId: `garment-${jobId}`,
    garmentTitle: 'Zarrin Bridal Lehenga',
    garmentThumbnailUrl: 'https://files.example/thumb.png',
    personPhotoId: 'photo-1',
    startedAt,
  });
}

describe('useTryOnTrayStore — actions', () => {
  beforeEach(() => {
    state().reset();
  });

  it('starts a job in QUEUED and unseen', () => {
    start('job-1');
    const job = state().jobs['job-1'];

    expect(job).toBeDefined();
    expect(job?.status).toBe('QUEUED');
    expect(job?.stage).toBe('QUEUED');
    expect(job?.startedAt).toBe(1_000);
    expect(job?.finishedAt).toBeNull();
    expect(job?.resultId).toBeNull();
    expect(job?.seen).toBe(false);
  });

  it('advances the stage and flips the job to RUNNING', () => {
    start('job-1');

    state().updateStage('job-1', 'UPLOADING');
    expect(state().jobs['job-1']?.stage).toBe('UPLOADING');
    expect(state().jobs['job-1']?.status).toBe('RUNNING');

    state().updateStage('job-1', 'GENERATING');
    expect(state().jobs['job-1']?.stage).toBe('GENERATING');
  });

  it('ignores a stage update for a job it does not know about', () => {
    const before = state().jobs;
    state().updateStage('ghost', 'GENERATING');

    expect(state().jobs).toBe(before);
  });

  it('completes a job with its result id, so the tray can link to the render', () => {
    start('job-1');
    state().completeJob({
      jobId: 'job-1',
      resultId: 'result-1',
      thumbnailUrl: 'https://files.example/r.png',
      cacheHit: true,
      finishedAt: 8_000,
    });

    const job = state().jobs['job-1'];
    expect(job?.status).toBe('SUCCEEDED');
    expect(job?.resultId).toBe('result-1');
    expect(job?.cacheHit).toBe(true);
    expect(job?.finishedAt).toBe(8_000);
    expect(job?.errorCode).toBeNull();
    expect(job?.seen).toBe(false);
  });

  it('fails a job with the §8.3 consumer copy, displayed as-is', () => {
    start('job-1');
    state().failJob({
      jobId: 'job-1',
      errorCode: 'UPSTREAM_NO_GARMENT_DETECTED',
      errorMessage:
        "We're having trouble with this piece — we've been notified. Try another for now.",
      finishedAt: 9_000,
    });

    const job = state().jobs['job-1'];
    expect(job?.status).toBe('FAILED');
    expect(job?.errorCode).toBe('UPSTREAM_NO_GARMENT_DETECTED');
    expect(job?.errorMessage).toContain("we've been notified");
    expect(job?.resultId).toBeNull();
  });

  it('cancels a job and marks it seen — she chose it, so there is nothing to notify', () => {
    start('job-1');
    state().cancelJob('job-1', 5_000);

    expect(state().jobs['job-1']?.status).toBe('CANCELLED');
    expect(state().jobs['job-1']?.seen).toBe(true);
  });

  it('dismisses one job without touching the others', () => {
    start('job-1', 1_000);
    start('job-2', 2_000);

    state().dismissJob('job-1');

    expect(state().jobs['job-1']).toBeUndefined();
    expect(state().jobs['job-2']).toBeDefined();
  });

  it('marks jobs seen individually and in bulk', () => {
    start('job-1', 1_000);
    start('job-2', 2_000);
    state().completeJob({ jobId: 'job-1', resultId: 'r1' });
    state().completeJob({ jobId: 'job-2', resultId: 'r2' });

    state().markSeen('job-1');
    expect(state().jobs['job-1']?.seen).toBe(true);
    expect(state().jobs['job-2']?.seen).toBe(false);

    state().markAllSeen();
    expect(state().jobs['job-2']?.seen).toBe(true);
  });

  it('clearFinished keeps the in-flight jobs — she is still waiting on those (C-19)', () => {
    start('running', 1_000);
    start('done', 2_000);
    start('broken', 3_000);
    state().updateStage('running', 'GENERATING');
    state().completeJob({ jobId: 'done', resultId: 'r1' });
    state().failJob({ jobId: 'broken', errorCode: 'UPSTREAM_TIMEOUT', errorMessage: 'x' });

    state().clearFinished();

    expect(Object.keys(state().jobs)).toEqual(['running']);
  });

  it('opens, closes and toggles the tray', () => {
    state().setTrayOpen(true);
    expect(state().trayOpen).toBe(true);

    state().toggleTray();
    expect(state().trayOpen).toBe(false);
  });

  it('tracks the active photo for the next try-on (C-16)', () => {
    state().setActivePhotoId('photo-2');
    expect(state().activePhotoId).toBe('photo-2');

    state().setActivePhotoId(null);
    expect(state().activePhotoId).toBeNull();
  });
});

describe('useTryOnTrayStore — selectors', () => {
  beforeEach(() => {
    state().reset();
  });

  it('isJobActive is true only while the job is still going', () => {
    const base: TrayJob = {
      jobId: 'j',
      garmentId: 'g',
      garmentTitle: 't',
      garmentThumbnailUrl: null,
      personPhotoId: null,
      status: 'QUEUED',
      stage: 'QUEUED',
      startedAt: 0,
      finishedAt: null,
      resultId: null,
      thumbnailUrl: null,
      errorCode: null,
      errorMessage: null,
      cacheHit: false,
      seen: false,
    };

    expect(isJobActive(base)).toBe(true);
    expect(isJobActive({ ...base, status: 'RUNNING' })).toBe(true);
    expect(isJobActive({ ...base, status: 'SUCCEEDED' })).toBe(false);
    expect(isJobActive({ ...base, status: 'FAILED' })).toBe(false);
    expect(isJobActive({ ...base, status: 'CANCELLED' })).toBe(false);
  });

  it('counts active and unseen jobs separately', () => {
    start('running', 1_000);
    start('done', 2_000);
    state().updateStage('running', 'GENERATING');
    state().completeJob({ jobId: 'done', resultId: 'r1' });

    expect(selectTrayActiveCount(state())).toBe(1);
    expect(selectHasActiveTrayJobs(state())).toBe(true);
    // An in-flight job is not "unseen" — the badge counts finished work she has not looked at.
    expect(selectTrayUnseenCount(state())).toBe(1);

    state().markAllSeen();
    expect(selectTrayUnseenCount(state())).toBe(0);
  });

  it('selectTrayJob reads one job by id', () => {
    start('job-1');

    expect(selectTrayJob('job-1')(state())?.jobId).toBe('job-1');
    expect(selectTrayJob('missing')(state())).toBeUndefined();
  });

  it('orders the tray newest first', () => {
    start('old', 1_000);
    start('new', 3_000);
    start('middle', 2_000);

    expect(selectTrayJobsNewestFirst(state()).map((job) => job.jobId)).toEqual([
      'new',
      'middle',
      'old',
    ]);
  });
});

describe('tray persistence — key, version and migration', () => {
  it('uses sessionStorage under the documented key', () => {
    expect(PERSIST_KEYS.tryOnTray).toBe('drape.tryon-tray');
  });

  it('keeps well-formed jobs', () => {
    const job = { jobId: 'j1', garmentId: 'g1', status: 'SUCCEEDED' };
    const migrated = migrateTrayState({ jobs: { j1: job }, activePhotoId: 'p1' }, TRAY_PERSIST_VERSION);

    expect(migrated.jobs.j1).toEqual(job);
    expect(migrated.activePhotoId).toBe('p1');
  });

  it('drops entries that are not recognisable jobs rather than repairing them', () => {
    const migrated = migrateTrayState(
      {
        jobs: {
          good: { jobId: 'good', garmentId: 'g1' },
          noGarment: { jobId: 'noGarment' },
          notAnObject: 'nope',
          nullish: null,
        },
        activePhotoId: 42,
      },
      TRAY_PERSIST_VERSION,
    );

    expect(Object.keys(migrated.jobs)).toEqual(['good']);
    expect(migrated.activePhotoId).toBeNull();
  });

  it('returns an empty tray for junk or a newer version', () => {
    const empty = { jobs: {}, activePhotoId: null };

    expect(migrateTrayState(null, 0)).toEqual(empty);
    expect(migrateTrayState({ jobs: 'nope' }, 0)).toEqual(empty);
    expect(migrateTrayState({ jobs: { a: { jobId: 'a', garmentId: 'g' } } }, TRAY_PERSIST_VERSION + 1)).toEqual(
      empty,
    );
  });
});
