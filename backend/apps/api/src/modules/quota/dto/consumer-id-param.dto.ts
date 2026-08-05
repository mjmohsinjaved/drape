import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/** The `:userId` route parameter of the A-18 admin quota routes (§5.16). */
export class ConsumerIdParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  userId: string;
}
