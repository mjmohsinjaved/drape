import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:userId` route parameter of every `/admin/users/**` and `/admin/consumers/**`
 * route (§5.2).
 *
 * `IdParamDto` in `@library/common` binds `:id`; these routes name the parameter
 * `userId`, and a param DTO keeps a malformed id inside the §2.3 validation envelope
 * instead of returning a bare `ParseUUIDPipe` 400.
 *
 * A uuid is unguessable but **is not** an authorisation check: the service still
 * verifies the target's role and, on self routes, ownership (§9.2).
 */
export class UserIdParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  userId: string;
}
