/**
 * Request interceptor — ARCHITECTURE.md §6.4.
 *
 * It adds exactly two headers and nothing else:
 * - `X-CSRF-Token` on every mutating method, copied from the readable `drape.csrf` cookie (B-8).
 * - `X-Request-Id`, so a browser failure and a server log line share one id (E-12).
 *
 * It never adds an `Authorization` header. There is no bearer token anywhere in the frontend — the
 * session is the httpOnly `drape.sid` cookie carried by `withCredentials` (B-6).
 */


import { CSRF_HEADER, REQUEST_ID_HEADER, SAFE_METHODS, generateRequestId } from '../config';
import { getCsrfToken } from '../csrf';

import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

/** Extra per-request fields this package sets. Declared here rather than by module augmentation. */
export interface DrapeRequestConfig extends InternalAxiosRequestConfig {
  /** Set by the interceptor so the response interceptor can report the same id on a failure. */
  requestId?: string;
  /** Guards the single `CSRF_TOKEN_INVALID` retry against becoming a loop (§6.4). */
  csrfRetried?: boolean;
}

export function isMutatingMethod(method: string | undefined): boolean {
  return !SAFE_METHODS.includes((method ?? 'get').toUpperCase());
}

export function applyRequestHeaders(config: DrapeRequestConfig): DrapeRequestConfig {
  const requestId = config.requestId ?? generateRequestId();
  config.requestId = requestId;
  config.headers.set(REQUEST_ID_HEADER, requestId);

  if (isMutatingMethod(config.method)) {
    const token = getCsrfToken();
    if (token !== null) {
      config.headers.set(CSRF_HEADER, token);
    }
  }

  return config;
}

export function setupRequestInterceptor(instance: AxiosInstance): number {
  return instance.interceptors.request.use(
    (config) => applyRequestHeaders(config as DrapeRequestConfig),
    (error: unknown) => Promise.reject(error),
  );
}
