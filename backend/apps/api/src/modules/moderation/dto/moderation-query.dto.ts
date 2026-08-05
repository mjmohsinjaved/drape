import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { ModerationSource } from '../enums/moderation-source.enum';
import { ModerationState } from '../enums/moderation-state.enum';

/** The columns the queue may be ordered by. Validated, never interpolated (§2.8). */
export const MODERATION_SORT_KEYS = ['createdAt', 'reviewedAt', 'state'] as const;

export type ModerationSortKey = (typeof MODERATION_SORT_KEYS)[number];

/**
 * `GET /admin/moderation` (A-34, §5.17).
 *
 * The default ordering is **oldest first**, which is the opposite of every other list
 * in this codebase and is deliberate: each pending item is a consumer who cannot
 * generate a try-on until somebody decides about her photograph. Newest-first would
 * quietly starve the person who has been waiting longest, and the E-14 backlog alert
 * says as much in its copy ("work the oldest items first — the queue sorts that way by
 * default").
 */
export class ModerationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MODERATION_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(MODERATION_SORT_KEYS)
  override sortBy: ModerationSortKey = 'createdAt';

  @ApiPropertyOptional({
    enum: ['ASC', 'DESC'],
    default: 'ASC',
    description: 'Oldest first by default — a pending item is a blocked account (A-34, E-14).',
  })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  override sortOrder: 'ASC' | 'DESC' = 'ASC';

  @ApiPropertyOptional({
    enum: ModerationState,
    enumName: 'ModerationState',
    description: 'Defaults to `PENDING` — the work queue. Pass a state to review past decisions.',
  })
  @IsOptional()
  @IsEnum(ModerationState)
  state?: ModerationState;

  @ApiPropertyOptional({ enum: ModerationSource, enumName: 'ModerationSource' })
  @IsOptional()
  @IsEnum(ModerationSource)
  source?: ModerationSource;
}

/**
 * The `:itemId` route parameter of `/admin/moderation/**`.
 *
 * A param DTO rather than `ParseUUIDPipe` so a malformed id stays inside the §2.3
 * validation envelope instead of returning a bare 400.
 */
export class ModerationItemParamDto {
  @ApiProperty({ format: 'uuid', example: '3f2e1d0b-9a8c-4d10-8f9e-6f8b1a2c7d10' })
  @IsUUID()
  itemId: string;
}
