import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { Locale } from '@library/common';

/** E.164, as `users.phone` stores it (§4.3). */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const lowerCased = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * `POST /auth/signup` — PRD C-2, S-4.
 *
 * C-2: name, email, password and phone are required; event date, event type and
 * budget band are prompted later, in context, and are not part of this payload.
 */
export class SignupDto {
  @ApiProperty({ maxLength: 120, example: 'Ayesha Khan' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ maxLength: 320, example: 'ayesha@example.com' })
  @Transform(lowerCased)
  @IsEmail()
  @MaxLength(320)
  email: string;

  /**
   * Validated against the S-6 policy in the service, not here, so a weak password
   * returns `PASSWORD_POLICY_VIOLATION` with its own copy rather than a generic
   * `VALIDATION_ERROR`.
   */
  @ApiProperty({
    minLength: 10,
    description: 'At least 10 characters, with a number and a symbol.',
  })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: '+923001234567', description: 'E.164.' })
  @Transform(trimmed)
  @IsString()
  @Matches(E164_PATTERN, { message: 'phone must be an E.164 number, e.g. +923001234567' })
  phone: string;

  @ApiPropertyOptional({ enum: Locale, default: Locale.EN })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  /**
   * **Accepted and ignored — PRD S-4.**
   *
   * "A role passed in the signup payload is ignored and logged." The global pipe
   * runs with `forbidNonWhitelisted`, so an undeclared property would be *rejected*
   * with a 400 — which is not what S-4 asks for, and which would tell a prober that
   * the field means something. Declaring it here lets the request succeed while the
   * value is stripped and audit-logged as `SIGNUP_ROLE_IGNORED`.
   *
   * It is typed as a bare string, not as `Role`, precisely so that no code path can
   * assign it anywhere a role is expected. Nothing reads it except the audit event.
   */
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Ignored. Signup always creates a Consumer account (S-4).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  role?: string;
}
