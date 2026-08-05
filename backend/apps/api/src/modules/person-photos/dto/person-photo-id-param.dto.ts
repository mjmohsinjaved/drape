import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:photoId` route parameter of every `/person-photos/**` route (§5.9).
 *
 * A param DTO rather than `ParseUUIDPipe`, so a malformed id stays inside the §2.3
 * validation envelope instead of returning a bare 400.
 *
 * A valid UUID here proves nothing about who may touch the row. §9.2: "object-level
 * ownership checks … never inferred from an unguessable ID." The service re-reads the
 * row with `{ id, userId }` in the predicate on every single operation.
 */
export class PersonPhotoIdParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  photoId: string;
}
