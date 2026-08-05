import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Role } from '@library/common';

import { InviteStatus } from '../enums/invite-status.enum';

/**
 * One invite, as the admin console sees it (S-5, §5.3).
 *
 * **No token, and no token hash.** The raw token exists for exactly as long as it
 * takes to render the email; the hash is a credential-equivalent — anyone holding
 * it can replay a lookup — so neither has a field here. An admin who loses the email
 * uses `POST /invites/:inviteId/resend`, which issues a **new** token; there is no
 * way to read the old one back, by design.
 */
export class InviteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ enum: [Role.ADMIN], description: 'Always ADMIN in V1 (S-5).' })
  role: Role;

  @ApiProperty({
    enum: InviteStatus,
    description: 'Derived from `consumedAt`, `expiresAt` and `deletedAt` — never stored (§4.9).',
  })
  status: InviteStatus;

  @ApiProperty({ format: 'date-time' })
  expiresAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  consumedAt: Date | null;

  @ApiProperty({ format: 'uuid', description: 'The admin who sent it.' })
  invitedBy: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The account created by accepting it.',
  })
  consumedByUserId: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/**
 * `GET /invites/token/:token` — what the acceptance form needs, and nothing more
 * (§5.3).
 *
 * This route is `@Public()`: whoever holds the emailed link has not signed in yet,
 * and cannot until this returns. So it answers three questions — which address the
 * invite is for, what role it grants, when it lapses — and reveals nothing about who
 * sent it, which other invites exist, or whether the address already has an account.
 */
export class InviteTokenPreviewResponseDto {
  @ApiProperty({ format: 'email', description: 'The address the account will be created for.' })
  email: string;

  @ApiProperty({ enum: [Role.ADMIN] })
  role: Role;

  @ApiProperty({ format: 'date-time' })
  expiresAt: Date;
}
