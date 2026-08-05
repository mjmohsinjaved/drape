import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import {
  AUDIT_ACTION_VALUES,
  AUDIT_TARGET_TYPES,
  type AuditAction,
  type AuditTargetType,
} from '@api/shared/constants/audit-actions.constant';

/**
 * The columns `GET /admin/audit` may sort by (§2.8: an allow-list, never
 * interpolation). `createdAt` is the only ordering the A-3 screen actually offers;
 * `action` is here so the list can be grouped without a second endpoint.
 */
export const AUDIT_SORTABLE_COLUMNS: readonly string[] = ['createdAt', 'action'];

/** Derived from the closed registry so there is exactly one list of target types. */
export const AUDIT_TARGET_TYPE_VALUES: readonly AuditTargetType[] =
  Object.values(AUDIT_TARGET_TYPES);

/** `GET /admin/audit` — filterable by actor, action and date range (A-3). */
export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by the acting user.' })
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by action. A member of the closed AUDIT_ACTIONS registry.',
    enum: AUDIT_ACTION_VALUES as string[],
  })
  @IsOptional()
  @IsIn(AUDIT_ACTION_VALUES as string[])
  action?: AuditAction;

  @ApiPropertyOptional({
    description: 'Filter by target type.',
    enum: AUDIT_TARGET_TYPE_VALUES as string[],
  })
  @IsOptional()
  @IsIn(AUDIT_TARGET_TYPE_VALUES as string[])
  targetType?: AuditTargetType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by the target row.' })
  @IsOptional()
  @IsUUID('4')
  targetId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive lower bound on `createdAt`, ISO-8601.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive upper bound on `createdAt`, ISO-8601.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: AUDIT_SORTABLE_COLUMNS as string[], default: 'createdAt' })
  @IsOptional()
  @IsIn(AUDIT_SORTABLE_COLUMNS as string[])
  override sortBy: string = 'createdAt';
}
