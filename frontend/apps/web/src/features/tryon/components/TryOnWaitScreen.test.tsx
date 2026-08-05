// @vitest-environment jsdom

import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTryOnTrayStore } from '@repo/store';

import { createRouterSpy, renderWithProviders } from '@/test/harness';

import type { TryOnJob } from '@/features/tryon/api/types';

/**
 * The reveal — PRD §10.3, C-19.
 *
 * The moment the whole product exists for: the generation finishes and she is taken to her
 * render. It was taken to `/en/en/renders/:id` instead, which matches no route and falls through
 * to the root `not-found.tsx` — an English-only "Page not found" at the end of a successful
 * try-on. Every file involved type-checked and linted; only a render catches it, which is why
 * this test exists at all.
 *
 * Nothing about the flow is stubbed except the network. `jsdom` has no `EventSource`, so
 * `useEventSource` takes the documented §5.11 fallback and polls `GET /tryon/jobs/:jobId` — so
 * this also covers the path a consumer on a locked-down network actually takes.
 */

const routerSpy = createRouterSpy();

vi.mock('next/navigation', () => ({
  useRouter: () => routerSpy.router,
  usePathname: () => '/en/tryon/job_1',
  useSearchParams: () => new URLSearchParams(),
}));

const getTryOnJob = vi.fn<(jobId: string) => Promise<TryOnJob>>();

vi.mock('@/features/tryon/api/endpoints', () => ({
  getTryOnJob: (jobId: string) => getTryOnJob(jobId),
  cancelTryOnJob: vi.fn(),
  tryOnStreamUrl: (jobId: string) => `http://api.test/tryon/jobs/${jobId}/stream`,
  newIdempotencyKey: () => 'key_1',
}));

function succeededJob(resultId: string): TryOnJob {
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

describe('§10.3 — the try-on reveal', () => {
  beforeEach(() => {
    routerSpy.pushed.length = 0;
    routerSpy.replaced.length = 0;
    getTryOnJob.mockReset();
    useTryOnTrayStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces to /{locale}/renders/{resultId} — once, with one locale segment', async () => {
    getTryOnJob.mockResolvedValue(succeededJob('res_1'));

    const { TryOnWaitScreen } = await import('@/features/tryon/components/TryOnWaitScreen');
    await renderWithProviders(<TryOnWaitScreen locale="en" jobId="job_1" />);

    await waitFor(() => {
      expect(routerSpy.replaced).toContain('/en/renders/res_1');
    });

    // The regression itself. `/en/en/renders/res_1` matches no route in the app.
    expect(routerSpy.replaced.every((href) => !/^\/en\/en\//.test(href))).toBe(true);
  });

  it('keeps the reveal inside the locale she is reading in', async () => {
    getTryOnJob.mockResolvedValue(succeededJob('res_2'));

    const { TryOnWaitScreen } = await import('@/features/tryon/components/TryOnWaitScreen');
    await renderWithProviders(<TryOnWaitScreen locale="ur" jobId="job_1" />, { locale: 'ur' });

    await waitFor(() => {
      expect(routerSpy.replaced).toContain('/ur/renders/res_2');
    });
  });

  it('writes the terminal state through to the tray, so C-19 can notify inline', async () => {
    useTryOnTrayStore.getState().startJob({
      jobId: 'job_1',
      garmentId: 'garment_1',
      garmentTitle: 'Ivory kalidar',
      startedAt: Date.now(),
    });
    getTryOnJob.mockResolvedValue(succeededJob('res_3'));

    const { TryOnWaitScreen } = await import('@/features/tryon/components/TryOnWaitScreen');
    await renderWithProviders(<TryOnWaitScreen locale="en" jobId="job_1" />);

    await waitFor(() => {
      expect(useTryOnTrayStore.getState().jobs.job_1?.status).toBe('SUCCEEDED');
    });
    expect(useTryOnTrayStore.getState().jobs.job_1?.resultId).toBe('res_3');
  });
});
