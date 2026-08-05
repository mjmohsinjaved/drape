// @vitest-environment jsdom

import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTryOnTrayStore } from '@repo/store';

import { timeZone } from '@/i18n/config';
import { loadClientMessages } from '@/i18n/messages';
import { renderWithProviders } from '@/test/harness';

import type { TryOnJob } from '@/features/tryon/api/types';
import type { ReactElement } from 'react';

/**
 * The tray — PRD C-19.
 *
 * Two defects live here, and neither is visible to a check that reads source.
 *
 * 1. **Hydration.** The store persists to `sessionStorage` through a synchronous storage, so
 *    zustand rehydrates at module-evaluation time — before React hydrates. The server renders no
 *    tray; the first client pass rendered a full one.
 * 2. **Reconciliation.** Terminal state was written only by `useTryOnJob`, mounted only by
 *    `TryOnWaitScreen`. Taking the wait screen's own "Keep browsing" action therefore stranded
 *    the job: a permanent spinner in the tray and nothing in her history.
 */

const getTryOnJob = vi.fn<(jobId: string) => Promise<TryOnJob>>();

vi.mock('@/features/tryon/api/endpoints', () => ({
  getTryOnJob: (jobId: string) => getTryOnJob(jobId),
  cancelTryOnJob: vi.fn(),
  tryOnStreamUrl: (jobId: string) => `http://api.test/tryon/jobs/${jobId}/stream`,
  newIdempotencyKey: () => 'key_1',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
  }),
  usePathname: () => '/en/browse',
  useSearchParams: () => new URLSearchParams(),
}));

function runningJob(jobId: string): void {
  useTryOnTrayStore.getState().startJob({
    jobId,
    garmentId: 'garment_1',
    garmentTitle: 'Ivory kalidar',
    startedAt: Date.now(),
  });
}

function succeeded(resultId: string): TryOnJob {
  return {
    jobId: 'job_1',
    status: 'SUCCEEDED',
    stage: 'FINISHING',
    garmentId: 'garment_1',
    personPhotoId: 'photo_1',
    cacheHit: false,
    errorCode: null,
    message: null,
    createdAt: new Date(0).toISOString(),
    result: { id: resultId, thumbnailUrl: null },
  } as unknown as TryOnJob;
}

beforeEach(() => {
  getTryOnJob.mockReset();
  useTryOnTrayStore.getState().reset();
});

describe('C-19 — the tray reconciles a job the wait screen is no longer watching', () => {
  it('settles an active row from GET /tryon/jobs/:id with no wait screen mounted', async () => {
    runningJob('job_1');
    getTryOnJob.mockResolvedValue(succeeded('res_1'));

    const { TryOnTray } = await import('@/features/tryon/components/TryOnTray');
    await renderWithProviders(<TryOnTray locale="en" />);

    await waitFor(() => {
      expect(useTryOnTrayStore.getState().jobs.job_1?.status).toBe('SUCCEEDED');
    });
    expect(useTryOnTrayStore.getState().jobs.job_1?.resultId).toBe('res_1');
    expect(getTryOnJob).toHaveBeenCalledWith('job_1');
  });

  it('announces the finished job inline, which is what C-19 promises', async () => {
    runningJob('job_1');
    getTryOnJob.mockResolvedValue(succeeded('res_1'));

    const { TryOnTray } = await import('@/features/tryon/components/TryOnTray');
    await renderWithProviders(<TryOnTray locale="en" />);

    await waitFor(() => {
      expect(screen.getByText(/Ivory kalidar is ready/i)).toBeDefined();
    });
  });

  it('stops the row spinning when the job is gone rather than leaving it running forever', async () => {
    runningJob('job_1');
    getTryOnJob.mockRejectedValue({ errorCode: 'JOB_NOT_FOUND' });

    const { TryOnTray } = await import('@/features/tryon/components/TryOnTray');
    await renderWithProviders(<TryOnTray locale="en" />);

    await waitFor(() => {
      expect(useTryOnTrayStore.getState().jobs.job_1?.status).toBe('FAILED');
    });
  });

  it('reconciles every concurrent job, not just the newest', async () => {
    runningJob('job_1');
    runningJob('job_2');
    getTryOnJob.mockImplementation((jobId: string) =>
      Promise.resolve({ ...succeeded(`res_${jobId}`), jobId }),
    );

    const { TryOnTray } = await import('@/features/tryon/components/TryOnTray');
    await renderWithProviders(<TryOnTray locale="en" />);

    await waitFor(() => {
      const jobs = useTryOnTrayStore.getState().jobs;
      expect(jobs.job_1?.status).toBe('SUCCEEDED');
      expect(jobs.job_2?.status).toBe('SUCCEEDED');
    });
  });
});

describe('§9.1 — the tray hydrates without a mismatch', () => {
  it('renders nothing on the server and nothing on the first client pass', async () => {
    getTryOnJob.mockResolvedValue(succeeded('res_1'));
    const messages = await loadClientMessages('en', 'consumer');

    const wrap = (node: ReactElement): ReactElement => (
      <NextIntlClientProvider locale="en" messages={messages} timeZone={timeZone}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {node}
        </QueryClientProvider>
      </NextIntlClientProvider>
    );

    /*
      The asymmetry has to be reproduced, not simulated, so this uses two module instances.

      On the server `sessionJsonStorage()` returns `undefined` — there is no `window` — zustand
      skips hydration, and the store's *initial* state, which is what `useSyncExternalStore` hands
      the server render, has no jobs in it. In the browser the same module evaluates with a
      populated `sessionStorage`, and because the storage is synchronous zustand rehydrates during
      module evaluation: the initial state already carries the finished job before React starts.
      React uses that same initial state as its hydration snapshot, so the two passes disagree.
    */
    window.sessionStorage.clear();
    vi.resetModules();
    const server = await import('@/features/tryon/components/TryOnTray');
    const serverHtml = renderToString(wrap(<server.TryOnTray locale="en" />));
    expect(serverHtml, 'the server has no sessionStorage, so it has no tray').toBe('');

    window.sessionStorage.setItem(
      'drape.tryon-tray',
      JSON.stringify({
        version: 1,
        state: {
          activePhotoId: null,
          jobs: {
            job_1: {
              jobId: 'job_1',
              garmentId: 'garment_1',
              garmentTitle: 'Ivory kalidar',
              garmentThumbnailUrl: null,
              personPhotoId: null,
              status: 'SUCCEEDED',
              stage: 'FINISHING',
              startedAt: 0,
              finishedAt: 1,
              resultId: 'res_1',
              thumbnailUrl: null,
              errorCode: null,
              errorMessage: null,
              cacheHit: false,
              seen: false,
            },
          },
        },
      }),
    );

    vi.resetModules();
    const client = await import('@/features/tryon/components/TryOnTray');

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.append(container);

    const recoverable: string[] = [];
    await act(async () => {
      hydrateRoot(container, wrap(<client.TryOnTray locale="en" />), {
        onRecoverableError: (error: unknown) => {
          recoverable.push(error instanceof Error ? error.message : String(error));
        },
      });
      await Promise.resolve();
    });

    expect(
      recoverable,
      'a tray that reads sessionStorage during the first client pass cannot match the server',
    ).toEqual([]);

    // And it is not simply gone: the content arrives on the commit after hydration.
    await waitFor(() => {
      expect(container.textContent).toContain('Ivory kalidar');
    });
  });
});
