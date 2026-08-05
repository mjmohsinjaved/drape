import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * `DELETE /auth/sessions/:sessionId` (§5.1).
 *
 * The parameter is named `sessionId` rather than `id` because that is what the §5
 * route table — the single source of truth for both the Nest route table and the
 * generated API client (B-4) — says it is.
 *
 * A uuid is unguessable but is **not** an authorisation check: `AuthService` still
 * verifies the row belongs to the caller before revoking it (§9.2).
 */
export class SessionIdParamDto {
  @ApiProperty({ format: 'uuid', description: 'One of the caller’s own sessions.' })
  @IsUUID()
  sessionId: string;
}
