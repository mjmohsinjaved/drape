/**
 * The endpoint layer — ARCHITECTURE.md §6.4.
 *
 * One typed function per route in §5, grouped by module. A feature imports the namespace it needs
 * and calls a named route; **no feature keeps its own path table, and no component builds a URL**.
 * A contract change therefore lands as a compile error in the package rather than as a 400 in
 * production, which is the whole point of B-4 / E-16.
 *
 * Namespaced rather than flattened because §5 reuses verbs across modules — `list`, `create` and
 * `remove` mean a dozen different things — and a flat barrel would either collide or force every
 * function to restate its module in its own name.
 *
 * ```ts
 * import { authApi } from '@repo/api-client';
 * const user = await authApi.getSession();
 * ```
 *
 * Server Components pass their request-scoped client through, so the caller's `drape.sid` is
 * forwarded and a module singleton never carries one visitor's cookie into another's render (B-9):
 *
 * ```ts
 * await authApi.getSession({ client: createServerApiClient(cookieHeader) });
 * ```
 */

export { type EndpointOptions, type QueryValue, toParams } from './http';

export * as accountApi from './account';
export * as authApi from './auth';

/**
 * The raw path tables, for the one caller that cannot use the functions: Server Components read
 * through the web app's own cookie-forwarding helper, which takes a path (B-9). Nothing else
 * should import these — a component building a URL is the drift this layer removes.
 */
export { accountPaths } from './account';
export { authPaths } from './auth';
