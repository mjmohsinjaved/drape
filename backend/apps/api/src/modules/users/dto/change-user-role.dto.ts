import { ApiProperty } from '@nestjs/swagger';

import { IsIn } from 'class-validator';

import { Role, USER_ROLES } from '@library/common';

/**
 * `PATCH /admin/users/:userId/role` (A-2).
 *
 * `Role.PUBLIC` is a TypeScript-only member and is not accepted here — `USER_ROLES`
 * is the persisted subset (§4.1).
 *
 * **This endpoint cannot create an admin.** S-5 allows exactly two origins for an
 * admin account: the deployment seed and an accepted invitation. The service
 * therefore refuses to promote a consumer, whatever this payload says; the only
 * transition it performs is `ADMIN → CONSUMER`.
 */
export class ChangeUserRoleDto {
  @ApiProperty({
    enum: USER_ROLES,
    description:
      'The role to move the account to. Promotion to ADMIN is rejected — admins arrive by ' +
      'invitation or by the deployment seed only (S-5).',
  })
  @IsIn(USER_ROLES)
  role: Role;
}
