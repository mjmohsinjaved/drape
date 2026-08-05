import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { ABUSE_WINDOW_HOURS, MAX_IP_BLOCK_REASON_LENGTH } from '../constants/moderation.constants';

/**
 * IPv4 or IPv6, with an optional prefix length — what `ip_blocks.cidr` (`cidr`, §4.8)
 * accepts.
 *
 * Validated here rather than left to PostgreSQL because a malformed value would come
 * back as a `22P02` from the driver, which the §2.3 envelope has no meaningful way to
 * describe. A caller who typed `192.168.0.0/33` deserves to be told which field is
 * wrong.
 */
export const CIDR_PATTERN =
  /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:3[0-2]|[12]?\d))?|[0-9a-fA-F:]+(?:\/(?:12[0-8]|1[01]\d|\d{1,2}))?)$/;

/** `GET /admin/abuse` (A-35, §5.17). */
export class AbuseQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 168,
    default: ABUSE_WINDOW_HOURS,
    description: 'How far back to look. Bounded at a week so the query stays index-friendly.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  windowHours: number = ABUSE_WINDOW_HOURS;
}

/**
 * One account on the A-35 list — "accounts hitting rate limits or repeated failures".
 *
 * The two sources §5.17 names are `auth_attempts` (§4.7) and `tryon_jobs` (§4.17), and
 * both are represented here. Neither carries an email address: `auth_attempts` stores
 * `emailHash` precisely so that it does not (E-12), and this DTO keeps that promise by
 * reporting a `userId` and nothing else identifying.
 */
export class AbusiveAccountResponseDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Null when the failures never resolved to an account — a probe, not a consumer.',
  })
  userId: string | null;

  @ApiProperty({ example: 41, description: 'Failed authentication attempts in the window (§4.7).' })
  authFailures: number;

  @ApiProperty({ example: 6, description: 'Failed generations in the window (§4.17).' })
  generationFailures: number;

  @ApiProperty({
    example: 3,
    description: 'Distinct source addresses the failures came from. A spread suggests a script.',
  })
  distinctIps: number;

  @ApiProperty({ format: 'date-time', description: 'The most recent failure in the window.' })
  lastFailureAt: Date;

  @ApiProperty({
    example: false,
    description: 'Whether the account is already suspended (A-19). Suspension itself is `users`.',
  })
  suspended: boolean;
}

/** `GET /admin/abuse` — the whole view. */
export class AbuseOverviewResponseDto {
  @ApiProperty({ example: 24 })
  windowHours: number;

  @ApiProperty({ format: 'date-time' })
  windowStartedAt: Date;

  @ApiProperty({ type: [AbusiveAccountResponseDto] })
  accounts: AbusiveAccountResponseDto[];

  @ApiProperty({
    example: 812,
    description: 'Failed authentication attempts across the platform in the window (E-14).',
  })
  totalAuthFailures: number;

  @ApiProperty({ example: 17, description: 'Active IP or CIDR blocks (§4.8).' })
  activeBlocks: number;
}

/** `POST /admin/abuse/ip-blocks` (A-35, §5.17). */
export class CreateIpBlockDto {
  @ApiProperty({
    example: '203.0.113.0/24',
    description: 'An address or a CIDR range. Stored in `ip_blocks.cidr` (§4.8).',
  })
  @IsString()
  @MaxLength(64)
  @Matches(CIDR_PATTERN, { message: 'cidr must be an IPv4/IPv6 address or CIDR range' })
  cidr: string;

  @ApiProperty({
    maxLength: MAX_IP_BLOCK_REASON_LENGTH,
    example: 'Credential stuffing against /auth/login, 400 attempts in an hour.',
    description: 'Required. A block with no stated reason is a block nobody can safely lift.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_IP_BLOCK_REASON_LENGTH)
  reason: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'When the block lifts itself. Omit for an indefinite block (§4.8).',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/** One `ip_blocks` row (§4.8). */
export class IpBlockResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '203.0.113.0/24' })
  cidr: string;

  @ApiProperty({ example: 'Credential stuffing against /auth/login.' })
  reason: string;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'uuid' })
  createdBy: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Null means indefinite (§4.8).',
  })
  expiresAt: Date | null;

  @ApiProperty({ example: true, description: 'False once `expiresAt` has passed.' })
  active: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/** The `:blockId` route parameter of `DELETE /admin/abuse/ip-blocks/:blockId`. */
export class IpBlockParamDto {
  @ApiProperty({ format: 'uuid', example: '7d10f9e6-1a2c-4b8b-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  blockId: string;
}
