import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:resultId` route parameter of every `/results/**` route (§5.12).
 *
 * A param DTO rather than `ParseUUIDPipe` so a malformed id stays inside the §2.3
 * validation envelope instead of returning a bare 400.
 */
export class ResultIdParamDto {
  @ApiProperty({ format: 'uuid', example: '9a1c4e70-1f3b-4a2d-8c6e-5b7d9f0a1c23' })
  @IsUUID()
  resultId: string;
}
