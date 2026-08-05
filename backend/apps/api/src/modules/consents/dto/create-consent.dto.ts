import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  Equals,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { Locale } from '@api/modules/users/enums/locale.enum';

/** `policy_versions.version` is `varchar(20)`, e.g. `2026.08.1` (§4.10). */
const POLICY_VERSION_PATTERN = /^[0-9]{4}\.[0-9]{2}\.[0-9]+$/;

/**
 * `POST /consents` (C-12).
 *
 * `policyVersion` is the version the client *displayed*. It is checked against the
 * version currently in force, so a gate left open in a background tab while an admin
 * published a new policy cannot record agreement to text she never saw.
 *
 * `accepted` must be literally `true`. C-11 requires the gate to be unskippable with
 * nothing pre-checked; a payload that omits it, or sends `false`, is a client that has
 * skipped the gate.
 */
export class CreateConsentDto {
  @ApiProperty({ example: '2026.08.1', description: 'The version the gate rendered.' })
  @IsString()
  @MaxLength(20)
  @Matches(POLICY_VERSION_PATTERN, { message: 'policyVersion must look like 2026.08.1' })
  policyVersion: string;

  @ApiProperty({ description: 'Must be true. C-11: nothing pre-checked, not skippable.' })
  @IsBoolean()
  @Equals(true, { message: 'Consent must be given explicitly.' })
  accepted: boolean;

  @ApiPropertyOptional({
    enum: Locale,
    description: 'Which translation she read. Defaults to the locale on her session.',
  })
  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}
