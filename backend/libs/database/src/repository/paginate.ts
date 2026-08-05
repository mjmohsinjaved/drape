import {
  buildPaginationMeta,
  DEFAULT_LIMIT,
  DEFAULT_SORT_BY,
  MAX_LIMIT,
  MIN_LIMIT,
  MIN_PAGE,
} from '@library/common';
import type { IPaginated, PaginationQueryDto } from '@library/common';

import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Optional ordering support. Omit it entirely and `paginate` will page a query builder that
 * the caller has already ordered.
 */
export interface PaginateOptions {
  /**
   * The columns this endpoint permits sorting by. ARCHITECTURE.md §2.8: `sortBy` is validated
   * **per module** against an allow-list before it reaches the query builder, and is never
   * interpolated. Pass the list here and `paginate` applies the ordering safely; pass nothing
   * and `paginate` applies no ordering at all.
   */
  readonly sortableColumns?: readonly string[];
  /** Query-builder alias the sortable columns belong to. Defaults to the builder's own alias. */
  readonly alias?: string;
  /**
   * Tie-breaker column appended to the ordering so that two rows with an identical sort key
   * cannot swap places between page 1 and page 2. Defaults to `id`; pass `null` to skip.
   */
  readonly tieBreakerColumn?: string | null;
}

/**
 * Runs a `SelectQueryBuilder` as a page and returns the one list shape the API is allowed to
 * return (ARCHITECTURE.md §2.8).
 *
 * Ownership scoping is **not** this function's job. §2.9 rule 6: "Every list query is scoped
 * by `userId` for consumers before any other filter is applied" — that happens in the service
 * that builds the query, and no amount of paging will rescue a query that forgot it.
 *
 * @example
 * const qb = this.repo.createQueryBuilder('garment').where('garment.userId = :userId', { userId });
 * return paginate(qb, query, { sortableColumns: ['createdAt', 'title', 'priceAmount'] });
 */
export async function paginate<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  query: PaginationQueryDto,
  options: PaginateOptions = {},
): Promise<IPaginated<T>> {
  const page = normalisePage(query.page);
  const limit = normaliseLimit(query.limit);
  const sortBy = query.sortBy ?? DEFAULT_SORT_BY;
  const sortOrder = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';

  if (options.sortableColumns !== undefined) {
    applyOrdering(qb, sortBy, sortOrder, options);
  }

  const [items, total] = await qb
    .skip((page - 1) * limit)
    .take(limit)
    .getManyAndCount();

  // `buildPaginationMeta` is the one place `totalPages` is derived (§2.8). A second copy
  // of `Math.ceil(total / limit)` here would be a second answer to "how many pages" the
  // day the rule gains an edge case.
  return { items, meta: buildPaginationMeta({ page, limit, sortBy, sortOrder }, total) };
}

/**
 * Applies `ORDER BY` from an allow-list. A `sortBy` outside the list is a programming error —
 * the module's query DTO should have rejected it with `@IsIn([...])` long before here — so it
 * throws rather than silently sorting by something else.
 */
function applyOrdering<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  sortBy: string,
  sortOrder: 'ASC' | 'DESC',
  options: PaginateOptions,
): void {
  const sortableColumns = options.sortableColumns ?? [];

  if (!sortableColumns.includes(sortBy)) {
    throw new Error(
      `sortBy "${sortBy}" is not in this endpoint's allow-list [${sortableColumns.join(', ')}]. Narrow sortBy with @IsIn([...]) on the query DTO (ARCHITECTURE.md §2.8).`,
    );
  }

  const alias = options.alias ?? qb.alias;
  qb.orderBy(`${alias}.${sortBy}`, sortOrder);

  // Without a tie-breaker, rows sharing a sort key can appear on two pages or on none.
  const tieBreaker = options.tieBreakerColumn === undefined ? 'id' : options.tieBreakerColumn;
  if (tieBreaker !== null && tieBreaker !== sortBy) {
    qb.addOrderBy(`${alias}.${tieBreaker}`, sortOrder);
  }
}

/**
 * The bounds come from `PaginationQueryDto` itself (§2.8), not from copies.
 *
 * They used to be re-declared here with a comment saying they "mirror" the DTO — which
 * is to say, they were a second set of numbers that had to be kept in step by hand.
 * Raising `MAX_LIMIT` on the DTO would have left this paginator silently clamping every
 * page to the old ceiling, and the endpoint would have accepted a `limit` it then
 * ignored.
 */
function normalisePage(value: number | undefined): number {
  return Number.isInteger(value) && (value as number) >= MIN_PAGE ? (value as number) : MIN_PAGE;
}

function normaliseLimit(value: number | undefined): number {
  if (!Number.isInteger(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(value as number, MIN_LIMIT), MAX_LIMIT);
}
