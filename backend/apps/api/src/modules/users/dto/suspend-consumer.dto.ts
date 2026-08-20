import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const MIN_SUSPENSION_REASON_LENGTH = 10;
export const MAX_SUSPENSION_REASON_LENGTH = 1000;

export class SuspendConsumerDto {
  @ApiPropertyOptional({
    minLength: MIN_SUSPENSION_REASON_LENGTH,
    maxLength: MAX_SUSPENSION_REASON_LENGTH,
    description: 'Why the account is on hold. Shown to the consumer (A-19, D-7).',
  })
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(MIN_SUSPENSION_REASON_LENGTH)
  @MaxLength(MAX_SUSPENSION_REASON_LENGTH)
  reason?: string;
}
