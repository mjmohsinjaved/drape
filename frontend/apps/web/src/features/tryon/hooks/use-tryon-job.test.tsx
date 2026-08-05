// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTryOnTrayStore } from '@repo/store';

import type { TryOnJob } from '@/features/tryon/api/types';
import type { ReactNode } from 'react';

/**
 * The §5.11 fallback, exercised through the hook that depends on it.
 *
 * §6.4: "try-on job status is driven by SSE, not polling, **with a 3 s polling fallback when
 * `EventSource` fails**." The fallback was unreachable for the commonest way a stream fails.
 *
 * Per the SSE spec an ordinary transport drop — a server restart, a phone losing its radio —
 * puts `readyState` back to `CONNECTING` and *then* fires `error`; only a fatal non-2xx handshake
 * reaches `CLOSED`. `useEventSource` returned early on `CONNECTING` without counting the attempt,
 * so a plain network drop looped in `reconnecting` forever: `isPolling` never became true and
 * `GET /tryon/jobs/:jobId` was never called. The wait screen span until she gave up.
 *
 * The fake below is the honest version of that failure — it never reaches `CLOSED`.
 */

const getTryOnJob = vi.fn<(jobId: string) => Promise<TryOnJob>>();

vi.mock('@/features/tryon/api/endpoints', () => ({
  getTryOnJob: (jobId: string) => getTryOnJob(jobId),
  cancelTryOnJob: vi.fn(),
  tryOnStreamUrl: (jobId: string) => `http://api.test/tryon/jobs/${jobId}/stream`,
  newIdempotencyKey: () => 'key_1',
}));

/** An `EventSource` that only ever fails the way a dropped connection does. */
class FlappingEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  static instances: FlappingEventSource[] = [];

  /** Never `CLOSED` — the browser is always "about to retry", which is the point. */
  readyState = FlappingEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FlappingEventSource.instances.push(this);
  }

  addEventListener(): void {
    /* the stream never delivers an event */
  }

  close(): void {
    this.readyState = FlappingEventSource.CLOSED;
  }

  /** One transport drop. */
  drop(): void {
    this.readyState = FlappingEventSource.CONNECTING;
    this.onerror?.();
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function running(): TryOnJob {
  return {
    jobId: 'job_1',
    status: 'RUNNING',
    stage: 'GENERATING',
    garmentId: 'garment_1',
    personPhotoId: 'photo_1',
    cacheHit: false,
    errorCode: null,
    message: null,
    createdAt: new Date(0).toISOString(),
    result: null,
  } as unknown as TryOnJob;
}

describe('§6.4 — the 3 s polling fallback', () => {
  beforeEach(() => {
    FlappingEventSource.instances = [];
    getTryOnJob.mockReset();
    getTryOnJob.mockResolvedValue(running());
    useTryOnTrayStore.getState().reset();
    vi.stubGlobal('EventSource', FlappingEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reaches polling after a run of ordinary transport drops, not only a fatal one', async () => {
    const { useTryOnJob } = await import('@/features/tryon/hooks/use-tryon-job');
    const { result } = renderHook(() => useTryOnJob('job_1', Date.now()), { wrapper });

    await waitFor(() => {
      expect(FlappingEventSource.instances.length).toBeGreaterThan(0);
    });
    expect(result.current.isPolling).toBe(false);

    // `maxRetries` defaults to 5. Every one of these leaves `readyState` at CONNECTING.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      for (const source of FlappingEventSource.instances) source.drop();
      await waitFor(() => {
        expect(FlappingEventSource.instances.length).toBeGreaterThan(0);
      });
      if (result.current.isPolling) break;
    }

    await waitFor(() => {
      expect(result.current.isPolling, 'a dropped connection must reach the poll').toBe(true);
    });
    expect(getTryOnJob).toHaveBeenCalledWith('job_1');
  });

  it('never leaves the stream CLOSED behind — the fake only ever reports CONNECTING', () => {
    // Guards the fake itself: if this stopped being true the test above would be proving the
    // old, already-working `CLOSED` path instead of the one that was broken.
    const source = new FlappingEventSource('http://api.test/stream');
    source.drop();
    expect(source.readyState).toBe(FlappingEventSource.CONNECTING);
  });
});
