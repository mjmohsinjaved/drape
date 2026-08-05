import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { BILLING_PERIOD_PATTERN, PaginationQueryDto } from '@library/common';

/** The columns a ledger list may be sorted by. Validated, never interpolated (§2.8). */
export const LEDGER_SORT_KEYS = ['createdAt', 'delta', 'period'] as const;

export type LedgerSortKey = (typeof LEDGER_SORT_KEYS)[number];

/**
 * The query for `GET /admin/usage/ledger` and
 * `GET /admin/consumers/:userId/quota-ledger` (§5.16).
 *
 * `sortBy` is narrowed with `@IsIn` per §2.8: an append-only ledger has three columns
 * worth ordering by and a query builder that accepted a fourth from the client would
 * be interpolating a caller-supplied identifier into SQL.
 */
export class LedgerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LEDGER_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(LEDGER_SORT_KEYS)
  override sortBy: LedgerSortKey = 'createdAt';

  @ApiPropertyOptional({
    example: '2026-08',
    description: '`YYYY-MM`. Defaults to the current period in `TIMEZONE` (§4.26).',
  })
  @IsOptional()
  @IsString()
  @Matches(BILLING_PERIOD_PATTERN, { message: 'period must be a YYYY-MM billing period' })
  period?: string;
}
