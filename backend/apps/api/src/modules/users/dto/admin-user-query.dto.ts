import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginationQueryDto, UserStatus } from '@library/common';

/**
 * Sortable columns for `GET /admin/users` (§2.8).
 *
 * The list is closed and every member is a real `users` column, because `paginate()`
 * interpolates the chosen name into `ORDER BY`. Nothing outside this array reaches
 * the query builder.
 */
export const ADMIN_USER_SORTABLE_COLUMNS = [
  'createdAt',
  'lastActiveAt',
  'lastLoginAt',
  'name',
  'email',
  'status',
] as const;

/** `GET /admin/users` — the admin directory (A-2). */
export class AdminUserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match on name or email.',
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

  @ApiPropertyOptional({ enum: ADMIN_USER_SORTABLE_COLUMNS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ADMIN_USER_SORTABLE_COLUMNS)
  override sortBy: string = 'createdAt';
}
