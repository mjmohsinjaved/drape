import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { Locale } from '@library/common';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `POST /invites/token/:token/accept` — ARCHITECTURE §5.3, PRD S-5.
 *
 * ### What is not on this DTO, and why
 *
 * **No `role`.** The role is read from the invite row the token resolves to. There is
 * no field here that could carry one, so there is no payload — malformed, malicious
 * or merely careless — that can influence whether the new account is an admin (S-4,
 * S-5).
 *
 * **No `email`.** Same reason. The address is the one the invitation was sent to; a
 * caller who could supply their own would be able to attach an admin role to any
 * address they liked, using a token issued for someone else's.
 *
 * The global pipe runs with `forbidNonWhitelisted`, so either field arriving in the
 * body is a 400 rather than a value that is silently dropped.
 */
export class AcceptInviteDto {
  @ApiProperty({ maxLength: 120, example: 'Bilal Ahmed' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  /**
   * Checked against the S-6 policy in the service rather than here, so a weak
   * password returns `PASSWORD_POLICY_VIOLATION` with its own copy instead of a
   * generic `VALIDATION_ERROR` — the same treatment signup gives it.
   */
  @ApiProperty({
    minLength: 10,
    description: 'At least 10 characters, with a number and a symbol.',
  })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiPropertyOptional({ enum: Locale, default: Locale.EN })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}
