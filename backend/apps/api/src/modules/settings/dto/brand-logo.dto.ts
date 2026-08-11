import { ApiProperty } from '@nestjs/swagger';

import { IsString, Matches, MaxLength } from 'class-validator';
const BRAND_KEY_PATTERN = /^brand\/[a-z0-9][a-z0-9\-/]*\.[a-z0-9]{2,5}$/;
const MAX_KEY_LENGTH = 512;

export class SetBrandLogoDto {
  @ApiProperty({
    example: 'brand/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.png',
    description: 'The storage key returned by the upload ticket redemption.',
  })
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  @Matches(BRAND_KEY_PATTERN, { message: 'A brand asset must live under the brand/ prefix.' })
  key: string;
}
