import { ApiProperty } from '@nestjs/swagger';

import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

/** The raw token is 32 random bytes, base64url — 43 characters, no padding. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** `:inviteId` on the admin routes. */
export class InviteIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  inviteId: string;
}

/**
 * `:token` on the two public routes.
 *
 * Shape-checked before it reaches the service so that a scan of obviously malformed
 * values is rejected by the validation pipe rather than costing a database round
 * trip each. The check says nothing about validity — that is a constant-time hash
 * lookup, and a well-formed unknown token is indistinguishable from an expired one
 * in the response.
 */
export class InviteTokenParamDto {
  @ApiProperty({ description: 'The single-use token from the invitation email.' })
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  @Matches(INVITE_TOKEN_PATTERN, { message: 'token is not a valid invitation token' })
  token: string;
}
