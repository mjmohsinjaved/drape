import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Locale, Role, UserStatus } from '@library/common';

/**
 * One admin account (A-2, §5.2).
 *
 * **What this class does not have a field for, at all:** `passwordHash`,
 * `twofaSecret`, `twofaRecoveryCodes`, any session token. 2FA is reported as the
 * boolean the console actually renders, derived from `twofaEnabledAt`; the secret
 * that boolean is derived from never leaves the database (S-8, §9.2).
 */
export class AdminUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Studio Admin' })
  name: string;

  @ApiProperty({ example: 'admin@example.com' })
  email: string;

  @ApiProperty({ enum: [Role.ADMIN, Role.CONSUMER] })
  role: Role;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ enum: Locale })
  locale: Locale;

  @ApiProperty({ description: 'Whether two-factor sign-in is on. S-8 requires it for admins.' })
  twofaEnabled: boolean;

  @ApiProperty()
  emailVerified: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastLoginAt: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastActiveAt: Date | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set when the account was deactivated or suspended.',
  })
  suspendedAt: Date | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The admin who invited this one (S-5). Null for the deployment seed account.',
  })
  invitedBy: string | null;

  @ApiProperty({ format: 'date-time', description: 'When the account was created.' })
  createdAt: Date;
}
