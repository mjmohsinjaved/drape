import { apiClient, getApiBaseUrl, type Paginated } from '@repo/api-client';

import type {
  MyQuota,
  StartTryOnBody,
  TryOnJob,
  TryOnJobQuery,
} from '@/features/tryon/api/types';

/**
 * Try-on and quota calls — ARCHITECTURE §5.11, §5.16, §6.4.
 *
 * Every call goes through the one browser instance, so the session cookie, the CSRF
 * double-submit, `X-Request-Id` and the §2.3 envelope unwrapping are inherited. **A component
 * never touches `apiClient`** — it calls a hook, which calls one of these.
 *
 * §6.4 puts these in `packages/api-client/src/endpoints/`. That directory does not exist yet and
 * `packages/**` belongs to another workstream, so they live beside the feature that needs them,
 * exactly as the admin catalog feature already does.
 */

export const tryOnPaths = {
  start: '/tryon',
  jobs: '/tryon/jobs',
  job: (jobId: string): string => `/tryon/jobs/${encodeURIComponent(jobId)}`,
  stream: (jobId: string): string => `/tryon/jobs/${encodeURIComponent(jobId)}/stream`,
  cancel: (jobId: string): string => `/tryon/jobs/${encodeURIComponent(jobId)}/cancel`,
  quota: '/quota/me',
} as const;

/**
 * The absolute stream URL.
 *
 * `EventSource` cannot carry a `baseURL`, an interceptor or a custom header, so the origin has
 * to be spelled out here. Credentials ride on the cookie (`withCredentials`), which is why the
 * API's CORS allows exactly the web origin (B-7).
 */
export function tryOnStreamUrl(jobId: string): string {
  return `${getApiBaseUrl()}${tryOnPaths.stream(jobId)}`;
}

/** A stable key for one intent. Re-sending it attaches to the running job instead of charging twice. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Only reachable on a runtime without WebCrypto. Still 128 bits of client-side uniqueness,
  // and the server treats the key as opaque.
  return `tryon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * How long the browser will hold `POST /tryon` open, in milliseconds.
 *
 * §8.2 has no queue: the API awaits the upstream call inside the request and answers with the
 * finished render, so this POST is as long as a generation. The shared `BROWSER_TIMEOUT_MS` is
 * 30s — right for every other call and shorter than a single TryOnCloud render, which lands at
 * roughly 20s and is retried up to `TRYON_MAX_ATTEMPTS` times with backoff. The client was
 * therefore aborting generations that were still running and were about to succeed, and showing
 * "That took too long" over the top of a render the account had already paid for.
 *
 * Three minutes covers the API's own worst case (3 attempts × 60s + backoff). It is a ceiling on
 * a request that normally answers in about twenty seconds, not an expected wait.
 */
const START_TRYON_TIMEOUT_MS = 180_000;

export async function startTryOn(body: StartTryOnBody): Promise<TryOnJob> {
  const response = await apiClient.post<TryOnJob>(tryOnPaths.start, body, {
    timeout: START_TRYON_TIMEOUT_MS,
  });
  return response.data;
}

export async function getTryOnJob(jobId: string, signal?: AbortSignal): Promise<TryOnJob> {
  const response = await apiClient.get<TryOnJob>(tryOnPaths.job(jobId), { signal });
  return response.data;
}

export async function cancelTryOnJob(jobId: string): Promise<TryOnJob> {
  const response = await apiClient.post<TryOnJob>(tryOnPaths.cancel(jobId));
  return response.data;
}

export async function listTryOnJobs(
  query: TryOnJobQuery = {},
  signal?: AbortSignal,
): Promise<Paginated<TryOnJob>> {
  const response = await apiClient.get<Paginated<TryOnJob>>(tryOnPaths.jobs, {
    params: query,
    signal,
  });
  return response.data;
}

/** `staleTime: 0` at the call site — it changes on every generation (§6.4). */
export async function getMyQuota(signal?: AbortSignal): Promise<MyQuota> {
  const response = await apiClient.get<MyQuota>(tryOnPaths.quota, { signal });
  return response.data;
}
