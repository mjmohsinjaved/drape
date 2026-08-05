import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /auth/password/forgot` — PRD S-6.
 *
 * The response is 200 with an identical body whatever this address is, so the form
 * cannot be used to discover which addresses have accounts.
 */
export class ForgotPasswordDto {
  @ApiProperty({ maxLength: 320 })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email: string;
}

/** `POST /auth/password/reset` — consumes a single-use 30-minute token (S-6). */
export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the emailed link. Single use.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @ApiProperty({ description: 'At least 10 characters, with a number and a symbol.' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

/** `POST /auth/password/change` — requires the current password (C-7). */
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: 'At least 10 characters, with a number and a symbol.' })
  @IsString()
  @IsNotEmpty()
  newPassword: string;
}
