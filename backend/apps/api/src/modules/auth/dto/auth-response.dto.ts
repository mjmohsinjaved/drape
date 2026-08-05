import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Locale, Role, UserStatus } from '@library/common';

/**
 * The caller, as `GET /auth/me` returns it — PRD B-10, S-3.
 *
 * This is the single role-resolution call the web middleware makes. It carries
 * **no** password hash, no 2FA secret, no recovery codes and no session token; the
 * role here selects which shell renders and is never an authorisation decision.
 */
export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: [Role.ADMIN, Role.CONSUMER] })
  role: Role;

  @ApiProperty()
  email: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  emailVerifiedAt: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  phoneVerifiedAt: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'E.164, masked to the last four.' })
  phone: string | null;

  @ApiProperty({ enum: Locale })
  locale: Locale;

  @ApiProperty({ description: 'Whether a second factor is enrolled (S-8).' })
  twofaEnabled: boolean;
}

/** `POST /auth/login` and `POST /auth/2fa/challenge` (§5.1). */
export class LoginResponseDto {
  @ApiProperty({ type: AuthUserDto, nullable: true })
  user: AuthUserDto | null;

  @ApiProperty({
    description:
      'True when the session is `twofaPending`: authenticate with POST /auth/2fa/challenge before anything else is reachable (S-8).',
  })
  twofaRequired: boolean;
}

/** `GET /auth/csrf` (§5.1). The cookie is set on the same response. */
export class CsrfTokenDto {
  @ApiProperty({ description: 'Echo this in the `X-CSRF-Token` header on every mutating call.' })
  csrfToken: string;

  @ApiProperty({ description: 'The cookie this token was written to.' })
  cookieName: string;

  @ApiProperty({ description: 'The header the API expects it back in.' })
  headerName: string;
}

/** One row of `GET /auth/sessions`. */
export class SessionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'True for the session making this request.' })
  current: boolean;

  @ApiProperty({ nullable: true, type: String })
  userAgent: string | null;

  @ApiProperty({ description: 'Truncated: the last octet or group is dropped (E-12).' })
  ip: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt: string;
}

/** `POST /auth/2fa/setup` — shown once, before the code is confirmed (S-8). */
export class TwoFactorSetupDto {
  @ApiProperty({ description: 'Base32 secret, for manual entry.' })
  secret: string;

  @ApiProperty({ description: '`otpauth://` URI to render as a QR code.' })
  provisioningUri: string;
}

/** `POST /auth/2fa/enable` — the recovery codes are returned exactly once (S-8). */
export class TwoFactorEnabledDto {
  @ApiProperty({
    type: [String],
    description: 'Shown once and never again. Only hashes are stored.',
  })
  recoveryCodes: string[];
}

/**
 * The generic acknowledgement.
 *
 * Password reset and email verification both return this, with **identical**
 * contents whether or not the address belongs to an account (S-6).
 */
export class AuthAcknowledgementDto {
  @ApiProperty({ description: 'True whenever the request was accepted for processing.' })
  accepted: boolean;

  @ApiPropertyOptional({ description: 'Present only where the outcome is not a secret.' })
  detail?: string;
}
