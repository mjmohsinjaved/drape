import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:categoryId` route parameter of every `/admin/categories/**` route (§5.5).
 *
 * `IdParamDto` in `@library/common` binds `:id`; these routes name the parameter
 * `categoryId`, and a param DTO keeps a malformed id inside the §2.3 validation
 * envelope instead of returning a bare `ParseUUIDPipe` 400.
 */
export class CategoryIdParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  categoryId: string;
}
