import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /auth/login` — PRD S-1, S-6.
 *
 * One form for both roles: the caller never states which kind of account they hold,
 * and the response never reveals it before authentication succeeds.
 */
export class LoginDto {
  @ApiProperty({ maxLength: 320, example: 'ayesha@example.com' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ description: 'Never logged, never echoed (E-12).' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
