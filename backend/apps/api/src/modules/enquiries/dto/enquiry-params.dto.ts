import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:enquiryId` route parameter, consumer and admin alike (§5.15).
 *
 * A valid uuid proves nothing about who may read the enquiry. The consumer routes
 * re-read the row with her `userId` in the predicate; the admin routes are gated by
 * `@Roles(Role.ADMIN)` and read every row by design (§9.2).
 */
export class EnquiryIdParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  enquiryId: string;
}
