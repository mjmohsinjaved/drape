import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Role } from '@api/modules/users/enums/role.enum';

/**
 * One `audit_log` row as the A-3 admin screen sees it.
 *
 * `ip` and `userAgent` are stored (§4.30) but **not projected**. They exist so an
 * incident can be reconstructed from the database by someone with a reason to look;
 * they are not part of a routine list read, and E-12 keeps personal data out of
 * anything that gets exported, screenshotted or pasted into a ticket.
 */
export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Null for system actions.' })
  actorId: string | null;

  @ApiPropertyOptional({ enum: Role, nullable: true })
  actorRole: Role | null;

  @ApiProperty({ description: 'A member of the closed AUDIT_ACTIONS registry.' })
  action: string;

  @ApiProperty({ description: 'A member of the closed AUDIT_TARGET_TYPES registry.' })
  targetType: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  targetId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Readable snapshot of the target.' })
  targetLabel: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Redacted before storage — never carries a photo key, email, phone or token.',
  })
  metadata: Record<string, unknown>;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  requestId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/** `GET /admin/audit/actions` — the closed registry, for the filter dropdown. */
export class AuditActionsResponseDto {
  @ApiProperty({ type: [String] })
  actions: string[];

  @ApiProperty({ type: [String] })
  targetTypes: string[];
}
