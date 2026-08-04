/**
 * Query-string construction for `@repo/api-client` and for Next.js link hrefs.
 *
 * Rules (ARCHITECTURE.md §2.2/§2.8: query parameters are camelCase):
 * - `null` and `undefined` are omitted entirely — "not filtered" and "filtered to nothing"
 *   must not collapse into the same request, and they must not poison the TanStack query key.
 * - Arrays are encoded as a **repeated key** (`?tag=a&tag=b`), which is what
 *   NestJS `@Query()` + `class-transformer` expects. Empty arrays are omitted.
 * - Key order follows insertion order, so the same params object always yields the same
 *   string — a prerequisite for stable cache keys.
 */

export type QueryPrimitive = string | number | boolean | null | undefined;
export type QueryValue = QueryPrimitive | readonly QueryPrimitive[];
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface BuildQueryStringOptions {
  /** Prefix the result with `?` when it is non-empty. Defaults to false. */
  prefix?: boolean;
  /** Treat `''` as a value to send rather than as "unset". Defaults to false (dropped). */
  keepEmptyStrings?: boolean;
  /** Sort keys alphabetically instead of using insertion order. Defaults to false. */
  sort?: boolean;
}

const isSkippable = (value: QueryPrimitive, keepEmptyStrings: boolean): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return true;
  }
  return !keepEmptyStrings && value === '';
};

/**
 * @example buildQueryString({ page: 1, publishState: 'PUBLISHED', search: undefined })
 *          // "page=1&publishState=PUBLISHED"
 * @example buildQueryString({ categoryId: ['a', 'b'] }, { prefix: true })
 *          // "?categoryId=a&categoryId=b"
 */
export function buildQueryString(
  params: QueryParams | null | undefined,
  options: BuildQueryStringOptions = {},
): string {
  const { prefix = false, keepEmptyStrings = false, sort = false } = options;

  if (params === null || params === undefined) {
    return '';
  }

  const searchParams = new URLSearchParams();
  const keys = sort ? Object.keys(params).sort() : Object.keys(params);

  for (const key of keys) {
    const value = params[key];

    if (Array.isArray(value)) {
      for (const item of value as readonly QueryPrimitive[]) {
        if (!isSkippable(item, keepEmptyStrings)) {
          searchParams.append(key, String(item));
        }
      }
      continue;
    }

    const primitive = value as QueryPrimitive;
    if (!isSkippable(primitive, keepEmptyStrings)) {
      searchParams.append(key, String(primitive));
    }
  }

  const query = searchParams.toString();

  if (query === '') {
    return '';
  }

  return prefix ? `?${query}` : query;
}

/** Appends a query string to a path, respecting a `?` the path may already carry. */
export function appendQueryString(path: string, params: QueryParams | null | undefined): string {
  const query = buildQueryString(params);

  if (query === '') {
    return path;
  }

  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}
