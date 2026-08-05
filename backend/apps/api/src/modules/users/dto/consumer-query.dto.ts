import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto, UserStatus } from '@library/common';

/**
 * Sortable columns for `GET /admin/consumers` (A-16, §2.8).
 *
 * Every member is a real `users` column. The three A-16 counts — generations this
 * month, shortlist size, enquiry count — are **derived per page** from
 * `quota_ledger`, `shortlist_items` and `enquiries`, so they are reported but not
 * sortable: sorting by them would mean aggregating the whole table on every
 * keystroke.
 */
export const CONSUMER_SORTABLE_COLUMNS = [
  'createdAt',
  'lastActiveAt',
  'name',
  'email',
  'status',
] as const;

/** `GET /admin/consumers` — the consumer list (A-16). */
export class ConsumerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match on name, email or phone.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
  )
  search?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Only accounts that have submitted at least one enquiry.',
  })
  @IsOptional()
  @Transform(({ value }): boolean | undefined => {
    if (value === true || value === 'true') {
      return true;
    }
    if (value === false || value === 'false') {
      return false;
    }
    return undefined;
  })
  @IsBoolean()
  hasEnquiries?: boolean;

  @ApiPropertyOptional({ enum: CONSUMER_SORTABLE_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsIn(CONSUMER_SORTABLE_COLUMNS)
  override sortBy: string = 'createdAt';
}
