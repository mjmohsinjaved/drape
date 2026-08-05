import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** `policy_versions.version` is `varchar(20)`, e.g. `2026.08.1` (§4.10). */
const POLICY_VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]+$/;

/** A policy body that fits in a tweet is a policy nobody has written yet. */
const MIN_BODY_LENGTH = 200;

export class PolicyRetentionInputDto {
  @ApiProperty({ example: 30, description: 'Days a person photo is kept (§9.3).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  photoDays: number;

  @ApiProperty({ example: true, description: 'Renders kept for the life of the account (C-27).' })
  @IsBoolean()
  rendersLifetime: boolean;
}

/**
 * `POST /settings/policy` — publish a new policy version (C-12).
 *
 * Publishing does not edit anything. It inserts a row and moves the `isCurrent` flag,
 * which re-gates every consumer on her next try-on, because the whole point of the
 * table is that the text she agreed to is preserved exactly as she read it.
 *
 * Both translations are required. A version that ships English-only would show the
 * Urdu gate an untranslated wall of text at the one moment consent has to be informed.
 */
export class CreatePolicyVersionDto {
  @ApiProperty({ example: '2026.09.1' })
  @IsString()
  @MaxLength(20)
  @Matches(POLICY_VERSION_PATTERN, { message: 'version must look like 2026.09.1' })
  version: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Defaults to now. A future date still becomes current immediately.',
  })
  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @ApiProperty({ description: 'Markdown. Must cover all five C-11 statements.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_BODY_LENGTH)
  bodyEn: string;

  @ApiProperty({ description: 'Markdown, Urdu.' })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_BODY_LENGTH)
  bodyUr: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  summaryEn: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  summaryUr: string;

  @ApiProperty({ type: PolicyRetentionInputDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PolicyRetentionInputDto)
  retentionSummary: PolicyRetentionInputDto;
}
