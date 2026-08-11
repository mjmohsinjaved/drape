import { ApiProperty } from '@nestjs/swagger';

import { IsString, Matches, MaxLength, MinLength } from 'class-validator';


const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** `splitToken` in `SignedUrlService` refuses anything longer. */
const MAX_TOKEN_LENGTH = 4096;

export class FileTokenParamDto {
  @ApiProperty({ description: 'An opaque, short-lived, HMAC-signed download token (§3.4).' })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_TOKEN_LENGTH)
  @Matches(TOKEN_PATTERN, { message: 'That link isn’t valid.' })
  token: string;
}

