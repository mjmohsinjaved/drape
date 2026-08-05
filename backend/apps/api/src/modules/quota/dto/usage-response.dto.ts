import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UsageReason } from '../enums/usage-reason.enum';

import type { BudgetState } from '../utils/ledger-math';

/**
 * The system-wide monthly budget (A-29, §4.27).
 *
 * `state` is what the try-on guard chain acts on: `EXHAUSTED` returns
 * `BUDGET_EXHAUSTED` from the **generation path only** — the catalog stays browsable
 * (A-29, §8.3), which is why this DTO is never consulted by `modules/catalog`.
 */
export class BudgetSnapshotResponseDto {
  @ApiProperty({ example: '2026-08' })
  period: string;

  @ApiProperty({ example: 2000, description: '`budget.monthlyGenerations` (A-29).' })
  limit: number;

  @ApiProperty({ example: 1612 })
  used: number;

  @ApiProperty({ example: 388, description: '`SUM(delta)` — never a stored column.' })
  remaining: number;

  @ApiProperty({ example: 80.6, description: 'Percent consumed, one decimal place.' })
  percentUsed: number;

  @ApiProperty({ example: 1600, description: 'The soft warning threshold (A-29, E-14).' })
  warnAt: number;

  @ApiProperty({ example: 2000, description: 'The hard stop (A-29).' })
  hardStopAt: number;

  @ApiProperty({ enum: ['OK', 'WARNING', 'EXHAUSTED'], example: 'WARNING' })
  state: BudgetState;

  @ApiProperty({ format: 'date-time' })
  resetsAt: Date;
}

/**
 * `GET /admin/usage` — the A-33 dashboard.
 *
 * Everything below is derived from `usage_ledger` by summing. The one A-33 figure not
 * present is **cache hits versus billed calls**: cache hits write no ledger row in
 * either table (C-22, §4.27), by design, so the hit count lives on `tryon_cache`,
 * which `TryOnModule` owns (§4.33). When that module lands it should surface the ratio
 * beside these numbers rather than this module reaching into its table — the same
 * seam `users.module.ts` documents in the other direction for `QuotaLedgerEntry`.
 */
export class AdminUsageResponseDto {
  @ApiProperty({ type: BudgetSnapshotResponseDto })
  budget: BudgetSnapshotResponseDto;

  @ApiProperty({ example: 1540, description: 'Consumer try-ons charged this period (A-33).' })
  consumerGenerations: number;

  @ApiProperty({ example: 72, description: 'Admin test renders charged this period (A-33).' })
  testRenders: number;

  @ApiProperty({
    example: 218.4,
    description: 'Generations per day over the trailing 7 days (A-33).',
  })
  trailingDailyRate: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description:
      'Projected exhaustion at the trailing rate, or null when the rate is zero or ' +
      'the budget lasts past the period boundary (A-33).',
  })
  projectedExhaustionAt: Date | null;
}

/** One `usage_ledger` row, for the reconciliation view (§5.16). */
export class UsageLedgerEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: -1 })
  delta: number;

  @ApiProperty({ enum: UsageReason, enumName: 'UsageReason' })
  reason: UsageReason;

  @ApiProperty({ example: '2026-08' })
  period: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  jobId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  userId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  actorId: string | null;

  @ApiProperty({
    example: 388,
    description:
      '**Advisory snapshot only** (§4.27). The authoritative remaining budget is ' +
      'always `SUM(delta)`; any code that decides on this field is a bug.',
  })
  balanceAfter: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}
