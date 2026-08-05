import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:imageId` route parameter of every `/admin/garment-images/**` route (§5.7).
 *
 * A param DTO rather than `ParseUUIDPipe`, for the same reason as `GarmentIdParamDto`: a
 * malformed id stays inside the §2.3 validation envelope instead of returning a bare 400.
 *
 * The id is a v4 uuid and therefore unguessable, which §3.3 is explicit is **not** an
 * authorisation check. The service still loads the row and works from the garment it belongs to.
 */
export class GarmentImageIdParamDto {
  @ApiProperty({ format: 'uuid', example: '0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b' })
  @IsUUID()
  imageId: string;
}
