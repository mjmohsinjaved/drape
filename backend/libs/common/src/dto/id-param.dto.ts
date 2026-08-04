import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The standard `:id` route parameter.
 *
 * Every primary key in the schema is a uuid (§4.0 rule 1), so a malformed id is a
 * validation error and never reaches the database. The uuid is unguessable but
 * **is not a substitute for an authorisation check** (§3.3) — the owning service
 * still verifies ownership on every read and mutation (§9.2).
 */
export class IdParamDto {
  @ApiProperty({
    description: 'Resource identifier.',
    format: 'uuid',
    example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c',
  })
  @IsUUID()
  id: string;
}
