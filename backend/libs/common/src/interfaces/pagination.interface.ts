/** Sort direction. UPPER_SNAKE_CASE on the wire, exactly as stored (§2.2). */
export type SortOrder = 'ASC' | 'DESC';

/**
 * The `meta` block of a paginated success envelope — ARCHITECTURE.md §2.8.
 * `ResponseTransformInterceptor` lifts this out of the service return value and
 * onto the envelope; it never appears inside `data`.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: string;
  sortOrder: SortOrder;
}

/**
 * The one and only shape a service returns for a list endpoint (§2.8).
 * Cursor pagination is not used in V1.
 */
export interface IPaginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/** The inputs `buildPaginationMeta` needs. Satisfied by `PaginationQueryDto`. */
export interface PaginationInput {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: SortOrder;
}

/** Builds a `PaginationMeta` from a query and a total row count. */
export function buildPaginationMeta(query: PaginationInput, total: number): PaginationMeta {
  const limit = Math.max(1, query.limit);
  return {
    page: Math.max(1, query.page),
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  };
}

/** Wraps items and a total into the `{ items, meta }` shape the interceptor unwraps. */
export function paginate<T>(items: T[], query: PaginationInput, total: number): IPaginated<T> {
  return { items, meta: buildPaginationMeta(query, total) };
}

/** The SQL `OFFSET` for a page. */
export function paginationSkip(query: Pick<PaginationInput, 'page' | 'limit'>): number {
  return (Math.max(1, query.page) - 1) * Math.max(1, query.limit);
}

/** true when `value` has the `{ items, meta }` shape the interceptor lifts. */
export function isPaginated(value: unknown): value is IPaginated<unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { items?: unknown; meta?: unknown };
  return (
    Array.isArray(candidate.items) &&
    candidate.meta !== null &&
    typeof candidate.meta === 'object' &&
    typeof (candidate.meta as PaginationMeta).total === 'number'
  );
}
