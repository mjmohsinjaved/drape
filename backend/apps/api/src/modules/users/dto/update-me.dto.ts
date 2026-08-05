import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { Locale } from '@library/common';

/** E.164, as stored in `users.phone` (§4.3). */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * `PATCH /me` — name, phone and locale (C-7).
 *
 * Email is **not** here. Changing an address is an identity change: it needs
 * re-verification and it belongs to `auth`, which owns `verification_tokens`.
 * Neither is role, status, quota or anything else an account could use to promote
 * itself — the only writable columns are the three below (S-4).
 *
 * Changing `phone` clears `phoneVerifiedAt`, so C-3 makes her re-verify before the
 * next enquiry. That is done by the service, not by the client sending a null.
 */
export class UpdateMeDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @IsOptional()
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: '+923001234567',
    description: 'E.164. Changing it clears phone verification (C-3).',
    nullable: true,
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @IsString()
  @Matches(E164_PATTERN, { message: 'phone must be an E.164 number, e.g. +923001234567' })
  phone?: string;

  @ApiPropertyOptional({ enum: Locale })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}
