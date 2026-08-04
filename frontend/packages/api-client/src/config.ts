/**
 * Transport-level constants and the two environment reads this package makes.
 *
 * ARCHITECTURE.md §7: only `NEXT_PUBLIC_*` reaches the browser, and **no secret ever carries the
 * `NEXT_PUBLIC_` prefix**. Nothing read here is a secret — a base URL and a devtools flag. The web
 * app validates these at build time with `@t3-oss/env-nextjs`; this package reads them lazily so a
 * unit test can run without them.
 */

/** §6.4 / B-8 — the double-submit CSRF header. The cookie half is readable by JS by design. */
export const CSRF_HEADER = 'X-CSRF-Token';

/** §7 `CSRF_COOKIE_NAME`. Readable by JS by design (B-8). */
export const CSRF_COOKIE_NAME = 'drape.csrf';

/** E-12 — mirrors the `X-Request-Id` response header and every log line for the request. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/** §6.4 — 30 s in the browser. */
export const BROWSER_TIMEOUT_MS = 30_000;

/** §6.4 — 10 s server-side: a Server Component render must not hang on a slow API. */
export const SERVER_TIMEOUT_MS = 10_000;

/** Methods that never need a CSRF token (§6.4). */
export const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * `NEXT_PUBLIC_API_BASE_URL` — browser → API base, e.g. `http://localhost:4000/api/v1` (§7, B-9).
 *
 * Deliberately not defaulted: a missing base URL should surface as an obvious misconfiguration at
 * the first request rather than as silent same-origin calls to the web app.
 */
export function getApiBaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_API_BASE_URL;
}

/**
 * `API_INTERNAL_URL` — the server-side base for cookie-forwarded fetches, falling back to the
 * public one (§7). Server-only, so it carries no `NEXT_PUBLIC_` prefix.
 */
export function getServerApiBaseUrl(): string | undefined {
   
  // server-only web variable; it is intentionally absent from turbo.json's globalEnv, which lists
  // only the variables that affect a cached build output.
  return process.env.API_INTERNAL_URL ?? getApiBaseUrl();
}

/** True outside production. Gates the TanStack devtools (`NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS`, §7). */
export function isQueryDevtoolsEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.NEXT_PUBLIC_ENABLE_QUERY_DEVTOOLS !== 'false';
}

/**
 * A correlation id for one request. Falls back to a non-cryptographic id when `crypto.randomUUID`
 * is unavailable — an insecure context, or an old runtime. The value only has to be unique enough
 * to correlate a log line, so this is not a security downgrade.
 */
export function generateRequestId(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const random = Math.random().toString(16).slice(2, 14);
  return `req-${Date.now().toString(16)}-${random}`;
}
