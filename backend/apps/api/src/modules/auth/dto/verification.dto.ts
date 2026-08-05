import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { E164_PATTERN } from './signup.dto';

/** `POST /auth/email/verify/confirm` — consumes the emailed token. */
export class ConfirmEmailDto {
  @ApiProperty({ description: 'The token from the emailed link. Single use.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;
}

/**
 * `POST /auth/phone/otp/request` — PRD C-3.
 *
 * `phone` is optional: a consumer who already has a number on file just asks for a
 * code, and one who is adding or correcting a number supplies it here.
 */
export class RequestPhoneOtpDto {
  @ApiPropertyOptional({ example: '+923001234567', description: 'E.164.' })
  @IsOptional()
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(E164_PATTERN, { message: 'phone must be an E.164 number, e.g. +923001234567' })
  phone?: string;
}

/** `POST /auth/phone/otp/verify` — stamps `phoneVerifiedAt` (C-3). */
export class VerifyPhoneOtpDto {
  @ApiProperty({ example: '123456', description: 'The six-digit code. Never logged (E-12).' })
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code: string;
}
