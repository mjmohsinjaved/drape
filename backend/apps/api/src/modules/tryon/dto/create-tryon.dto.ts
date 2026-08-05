import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/** `tryon_jobs.idempotencyKey` is `varchar(80)` (§4.17). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 80;

/**
 * `POST /tryon` — §5.11, PRD §8.1 step 1.
 *
 * > "Browser posts `{garment_id, idempotency_key}` … The photo is referenced by stored
 * > ID, never re-uploaded."
 *
 * Note what is **not** here: no image, no storage key, no user id. The photo is
 * referenced by id and resolved server-side against the session (guard-chain step 11),
 * and the caller is whoever the session says it is (S-3). A body that could name a
 * photo by key would be a body that could name someone else's.
 */
export class CreateTryOnDto {
  @ApiProperty({ format: 'uuid', description: 'The published garment to try on.' })
  @IsUUID()
  garmentId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Which saved photo to use. Omit for the active one (C-16).',
  })
  @IsOptional()
  @IsUUID()
  personPhotoId?: string;

  @ApiProperty({
    maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
    example: '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
    description:
      'Client-generated, stable for one intent. A double-click reuses it and gets ' +
      'IDEMPOTENCY_IN_FLIGHT with the running job id rather than a second charge (§8.4).',
  })
  @IsString()
  @Length(8, MAX_IDEMPOTENCY_KEY_LENGTH)
  // Constrained so a key cannot smuggle anything interesting into a log line or an index.
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'idempotencyKey may contain letters, digits, dot, underscore, colon and hyphen only',
  })
  idempotencyKey: string;
}
