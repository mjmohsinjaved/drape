/**
 * CSRF double-submit support (PRD B-8, ARCHITECTURE.md §6.4).
 *
 * There is no token to store. The session is the httpOnly `drape.sid` cookie; the CSRF cookie is
 * readable by JS **by design**, and the client's only job is to copy its value into the
 * `X-CSRF-Token` header on every mutating request. Nothing here writes to `localStorage` (B-6).
 */

import { CSRF_COOKIE_NAME } from './config';

/** Reads a cookie by name in the browser. Always `null` on the server — there is no `document`. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length));
    }
  }
  return null;
}

/** The current double-submit token, or `null` when `GET /auth/csrf` has not run yet. */
export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE_NAME);
}

type CsrfFetcher = () => Promise<unknown>;

let csrfFetcher: CsrfFetcher | null = null;
let inFlight: Promise<unknown> | null = null;

/**
 * Registers how the CSRF cookie is obtained. Called once at app start with a function that hits
 * `GET /auth/csrf`; kept as an injection point so this module has no import cycle with the axios
 * instance, and so tests can supply a stub.
 */
export function setCsrfFetcher(fetcher: CsrfFetcher | null): void {
  csrfFetcher = fetcher;
  inFlight = null;
}

/**
 * §6.4: calls `GET /auth/csrf` once per page load before the first mutation if the cookie is
 * absent. Concurrent callers share the one in-flight request.
 *
 * @param force re-fetch even when a cookie is present — the single retry on `CSRF_TOKEN_INVALID`.
 */
export async function ensureCsrf(force = false): Promise<string | null> {
  if (!force && getCsrfToken() !== null) return getCsrfToken();
  if (csrfFetcher === null) return getCsrfToken();

  inFlight ??= csrfFetcher().finally(() => {
    inFlight = null;
  });

  await inFlight;
  return getCsrfToken();
}
