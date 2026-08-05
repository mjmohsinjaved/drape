import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:garmentId` route parameter of every `/admin/garments/**` route (§5.6).
 *
 * A param DTO rather than `ParseUUIDPipe` so a malformed id stays inside the §2.3
 * validation envelope instead of returning a bare 400.
 */
export class GarmentIdParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  garmentId: string;
}
