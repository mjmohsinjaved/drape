import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Locale, Role, UserStatus } from '@library/common';

/**
 * `GET /me` and `PATCH /me` (§5.2).
 *
 * The caller's own account. Even here there is no `passwordHash`, no `twofaSecret`,
 * no recovery code and no session token — an account reading its own row is still a
 * network response, and a credential that never serialises cannot leak through a
 * log, a cache or a browser extension (§9.2).
 */
export class MeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty({ enum: [Role.ADMIN, Role.CONSUMER] })
  role: Role;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ enum: Locale })
  locale: Locale;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty()
  phoneVerified: boolean;

  @ApiProperty({ description: 'Whether two-factor sign-in is on (S-8).' })
  twofaEnabled: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastLoginAt: Date | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set once she has asked for her account to be deleted (C-38).',
  })
  deletionRequestedAt: Date | null;
}
