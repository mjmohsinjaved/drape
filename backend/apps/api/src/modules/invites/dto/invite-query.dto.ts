import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { InviteStatus } from '../enums/invite-status.enum';

/** Sortable columns for `GET /invites` (§2.8). All are real `invites` columns. */
export const INVITE_SORTABLE_COLUMNS = ['createdAt', 'expiresAt', 'email', 'consumedAt'] as const;

/**
 * `GET /invites` (S-5).
 *
 * `status` filters on a value that **is not a column** — it is derived from
 * `consumedAt`, `expiresAt` and `deletedAt` (§4.9). The service translates it into
 * predicates over those three; there is nothing to sort or index on directly, which
 * is exactly why the status is not stored.
 */
export class InviteQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: InviteStatus,
    description: 'Derived from the columns, not stored. `REVOKED` reads soft-deleted rows.',
  })
  @IsOptional()
  @IsEnum(InviteStatus)
  status?: InviteStatus;

  @ApiPropertyOptional({ description: 'Case-insensitive partial match on the email.' })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  @Transform(({ value }): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
  )
  search?: string;

  @ApiPropertyOptional({ enum: INVITE_SORTABLE_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsIn(INVITE_SORTABLE_COLUMNS)
  override sortBy: string = 'createdAt';
}
