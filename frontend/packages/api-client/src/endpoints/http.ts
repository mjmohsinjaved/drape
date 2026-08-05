/**
 * The transport the `endpoints/` layer is built on — ARCHITECTURE.md §6.4.
 *
 * §6.4 asks for **one typed function per route in §5**, grouped by module, so that no feature has
 * to keep a private path table and no component ever reaches for `apiClient` itself. This module
 * is the only place in that layer that touches axios.
 *
 * Three things are already true by the time a value comes back from here, because the shared
 * interceptors did them:
 *
 * - the §2.3 envelope is off — `data` is the payload, and a §2.8 list arrives as `{ items, meta }`;
 * - every rejection is an `ApiError`, never a raw `AxiosError`;
 * - the CSRF double-submit header and `X-Request-Id` are on the request.
 *
 * So the functions below are a thin, honestly-typed naming of the route table and nothing more.
 */

import { apiClient } from '../axios-instance';

import type { Paginated } from '../types/envelope';
import type { AxiosInstance } from 'axios';

/**
 * Per-call knobs every endpoint function accepts.
 *
 * `client` exists for Server Components: `createServerApiClient(cookieHeader)` returns a
 * request-scoped instance carrying the caller's `drape.sid`, and a module singleton would carry
 * one visitor's cookie into another visitor's render (B-9). Omitted, the browser instance is used.
 */
export interface EndpointOptions {
  client?: AxiosInstance;
  /** Wire this to TanStack Query's `signal` so a superseded query actually stops. */
  signal?: AbortSignal;
}

/** Query-string values the API accepts. Arrays serialise as repeated keys — see {@link toParams}. */
export type QueryValue = string | number | boolean | readonly string[] | readonly number[];

function instance(options: EndpointOptions): AxiosInstance {
  return options.client ?? apiClient;
}

/**
 * Drops `undefined`, `null` and `''` so an unset filter never reaches the API as `?color=`.
 *
 * An empty string is not the same as an absent filter to a validation pipe: `?status=` fails
 * `@IsEnum` where omitting it is simply "no filter". Empty arrays go too, for the same reason.
 */
export function toParams<TQuery extends object>(query: TQuery): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  // `TQuery` is an interface, which has no implicit index signature — the assertion narrows the
  // `any` that `Object.entries` hands back for a bare `object`, it does not widen anything.
  for (const [key, value] of Object.entries(query) as ReadonlyArray<[string, unknown]>) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params[key] = value as readonly string[] | readonly number[];
      continue;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params[key] = value;
    }
  }

  return params;
}

export async function get<TData>(
  path: string,
  options: EndpointOptions = {},
  params?: object,
): Promise<TData> {
  const response = await instance(options).get<TData>(path, {
    signal: options.signal,
    params: params === undefined ? undefined : toParams(params),
  });
  return response.data;
}

/** A §2.8 list route. The interceptor has already lifted `meta` out of the envelope. */
export async function getList<TItem>(
  path: string,
  options: EndpointOptions = {},
  params?: object,
): Promise<Paginated<TItem>> {
  return get<Paginated<TItem>>(path, options, params);
}

export async function post<TData, TBody = undefined>(
  path: string,
  body?: TBody,
  options: EndpointOptions = {},
): Promise<TData> {
  const response = await instance(options).post<TData>(path, body, { signal: options.signal });
  return response.data;
}

export async function patch<TData, TBody>(
  path: string,
  body: TBody,
  options: EndpointOptions = {},
): Promise<TData> {
  const response = await instance(options).patch<TData>(path, body, { signal: options.signal });
  return response.data;
}

export async function put<TData, TBody>(
  path: string,
  body: TBody,
  options: EndpointOptions = {},
): Promise<TData> {
  const response = await instance(options).put<TData>(path, body, { signal: options.signal });
  return response.data;
}

export async function del<TData>(path: string, options: EndpointOptions = {}): Promise<TData> {
  const response = await instance(options).delete<TData>(path, { signal: options.signal });
  return response.data;
}

/**
 * A `204 No Content` route.
 *
 * Typed separately from {@link del} so that nothing downstream can read a body off a response
 * that has none. Several §5 deletes answer 204 — a `Promise<void>` is the honest return type,
 * and a caller that destructures a payload out of one fails to compile.
 */
export async function delNoContent(path: string, options: EndpointOptions = {}): Promise<void> {
  await instance(options).delete<void>(path, { signal: options.signal });
}

/**
 * A `DELETE` that carries a body — the D-17 confirmation routes.
 *
 * A typed confirmation is a payload, not a query parameter: it is the user's own words, and it has
 * no business in a URL that ends up in a proxy log.
 */
export async function delWithBody<TData, TBody>(
  path: string,
  body: TBody,
  options: EndpointOptions = {},
): Promise<TData> {
  const response = await instance(options).delete<TData>(path, {
    data: body,
    signal: options.signal,
  });
  return response.data;
}

/** {@link delWithBody} for a route that answers `204 No Content`. */
export async function delWithBodyNoContent<TBody>(
  path: string,
  body: TBody,
  options: EndpointOptions = {},
): Promise<void> {
  await instance(options).delete<void>(path, { data: body, signal: options.signal });
}

/** Percent-encodes a path segment. Slugs, tokens and emails all reach routes this way. */
export function segment(value: string): string {
  return encodeURIComponent(value);
}
