import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import type { SortOrder } from '../interfaces/pagination.interface';

/** Lowest accepted page number. */
export const MIN_PAGE = 1;

/** Lowest accepted page size. */
export const MIN_LIMIT = 1;

/** Highest accepted page size. A larger page is a validation error, never a clamp. */
export const MAX_LIMIT = 100;

/** Default page size (§2.8). */
export const DEFAULT_LIMIT = 20;

/** Default sort column (§2.8). */
export const DEFAULT_SORT_BY = 'createdAt';

/** Default sort direction (§2.8). */
export const DEFAULT_SORT_ORDER: SortOrder = 'DESC';

/**
 * The base query for every list endpoint — ARCHITECTURE.md §2.8.
 *
 * **`sortBy` is validated per module against an allow-list before it reaches the
 * query builder — never interpolated.** Module query DTOs extend this class, add
 * `search` plus their own filters, and narrow `sortBy` with `@IsIn([...])`.
 *
 * Cursor pagination is not used in V1.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: '1-based page number.',
    default: MIN_PAGE,
    minimum: MIN_PAGE,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_PAGE)
  page: number = MIN_PAGE;

  @ApiPropertyOptional({
    description: 'Rows per page.',
    default: DEFAULT_LIMIT,
    minimum: MIN_LIMIT,
    maximum: MAX_LIMIT,
    example: DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_LIMIT)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description:
      'Column to sort by. Each module narrows this with `@IsIn([...])`; an unlisted ' +
      'value is rejected rather than passed to the query builder.',
    default: DEFAULT_SORT_BY,
    example: DEFAULT_SORT_BY,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sortBy: string = DEFAULT_SORT_BY;

  @ApiPropertyOptional({
    description: 'Sort direction.',
    enum: ['ASC', 'DESC'],
    default: DEFAULT_SORT_ORDER,
    example: DEFAULT_SORT_ORDER,
  })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: SortOrder = DEFAULT_SORT_ORDER;
}
