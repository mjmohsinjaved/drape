import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * `POST /invites` — invite an admin by email (S-5, A-2).
 *
 * **There is no `role` field, and there will not be one.** S-5 allows admin accounts
 * from exactly two origins, and this is one of them; every invite is `Role.ADMIN`.
 * A role in the payload would be the one place in the system where a request body
 * chooses a privilege level, which is the escalation this route exists to make
 * impossible. The route is `@Roles(Role.ADMIN)`, so a consumer cannot reach it at
 * all.
 *
 * The address is lower-cased and trimmed here, matching how `invites.email` and
 * `users.email` are stored (§4.3, §4.9) — otherwise `Ayesha@…` and `ayesha@…` would
 * slip past both the duplicate-account check and the one-pending-invite index.
 */
export class CreateInviteDto {
  @ApiProperty({
    format: 'email',
    maxLength: 320,
    example: 'new.admin@example.com',
    description: 'Stored lower-cased. The invited account is always an ADMIN (S-5).',
  })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email: string;
}
