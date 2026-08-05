import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A six-digit TOTP code — `POST /auth/2fa/enable` and `POST /auth/2fa/challenge`
 * (PRD S-8).
 */
export class TwoFactorCodeDto {
  @ApiProperty({ example: '123456', description: 'Never logged (E-12).' })
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code: string;
}

/** `POST /auth/2fa/recovery` — completes a `twofaPending` session with a recovery code. */
export class TwoFactorRecoveryDto {
  @ApiProperty({ example: 'A2B3C-D4E5F', description: 'Single use. Never logged (E-12).' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  recoveryCode: string;
}

/**
 * `POST /auth/2fa/disable` — rejected for admins (S-8).
 *
 * The current password is required: turning a second factor off is exactly the
 * action a hijacked session would attempt.
 */
export class DisableTwoFactorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: '123456', description: 'A live code from the authenticator app.' })
  @Transform(trimmed)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code: string;
}
