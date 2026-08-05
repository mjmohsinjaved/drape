import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

/** The columns the in-app list may be ordered by. Validated, never interpolated (§2.8). */
export const NOTIFICATION_SORT_KEYS = ['createdAt', 'readAt'] as const;

export type NotificationSortKey = (typeof NOTIFICATION_SORT_KEYS)[number];

/**
 * `GET /me/notifications` (A-25, §5.2).
 *
 * There is no `userId` filter and there never will be one: the predicate comes from
 * the session, so no query string can widen the result set to another account (§9.2).
 */
export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(NOTIFICATION_SORT_KEYS)
  override sortBy: NotificationSortKey = 'createdAt';

  @ApiPropertyOptional({
    description: 'Only notifications she has not opened yet.',
    default: false,
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly: boolean = false;
}

/**
 * The `:notificationId` route parameter of `POST /me/notifications/:notificationId/read`.
 *
 * A param DTO rather than `ParseUUIDPipe` so a malformed id stays inside the §2.3
 * validation envelope instead of returning a bare 400.
 */
export class NotificationIdParamDto {
  @ApiProperty({ format: 'uuid', example: '2b7c1d90-3e45-4c8a-9f16-0d2a4b6c8e10' })
  @IsUUID()
  notificationId: string;
}
