import { ApiProperty } from '@nestjs/swagger';

import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `DELETE /admin/garments/:garmentId` — **D-17**.
 *
 * > "A destructive action asks the admin to type the name of the thing being
 * > destroyed."
 *
 * Server-side, not a client-side modal: a confirmation the API does not check is a
 * confirmation an API client skips. `GarmentsService` compares this against the
 * stored title case-insensitively after trimming — the admin is proving intent, not
 * their typing.
 */
export class DeleteGarmentDto {
  @ApiProperty({
    description: 'Must match the garment title exactly (case- and whitespace-insensitive).',
    maxLength: 160,
    example: 'Zarrin Bridal Lehenga',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  confirmTitle: string;
}
