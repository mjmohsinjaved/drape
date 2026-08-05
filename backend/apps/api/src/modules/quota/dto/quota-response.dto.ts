import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { QuotaReason } from '../enums/quota-reason.enum';

/**
 * `GET /quota/me` — the persistent counter (C-5, §5.16).
 *
 * Every number here is **derived at read time** by summing `quota_ledger` (§4.26).
 * There is no balance column behind any of them, and a field on this DTO must never
 * be sourced from one.
 */
export class QuotaSnapshotResponseDto {
  @ApiProperty({ example: '2026-08', description: '`YYYY-MM` in `TIMEZONE` (§4.26).' })
  period: string;

  @ApiProperty({
    example: 15,
    description:
      'Her allowance this period: the monthly grant plus any mid-period override ' +
      'raise and admin adjustment (A-18, A-28).',
  })
  limit: number;

  @ApiProperty({
    example: 4,
    description: 'Generations charged this period. Cache hits are not (C-22).',
  })
  used: number;

  @ApiProperty({ example: 11, description: '`SUM(delta)` — the authoritative number.' })
  remaining: number;

  @ApiProperty({
    format: 'date-time',
    description: 'Local midnight starting the next period, in `TIMEZONE`.',
  })
  resetsAt: Date;
}

/**
 * One `quota_ledger` row for the A-18 admin view.
 *
 * Append-only, so there is no `updatedAt` and no `deletedAt` to report (§2.1).
 */
export class QuotaLedgerEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: -1, description: 'Positive grants, negative consumption.' })
  delta: number;

  @ApiProperty({ enum: QuotaReason, enumName: 'QuotaReason' })
  reason: QuotaReason;

  @ApiProperty({ example: '2026-08' })
  period: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  jobId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  actorId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}
