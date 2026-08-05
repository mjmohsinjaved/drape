import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Locale } from '@api/modules/users/enums/locale.enum';

/** C-11 retention summary, as the consent gate renders it. */
export class PolicyRetentionDto {
  @ApiProperty({ description: 'Days a person photo is kept after last account activity (§9.3).' })
  photoDays: number;

  @ApiProperty({ description: 'True when renders are kept for the life of the account (C-27).' })
  rendersLifetime: boolean;
}

/**
 * `GET /consents/policy` — the policy text the C-11 gate displays, in one locale.
 *
 * Public by design: a consumer has to be able to read what she is agreeing to before
 * she has an account, and the gate is the first thing a new consumer meets.
 */
export class PolicyResponseDto {
  @ApiProperty({ example: '2026.08.1', description: 'The version she is consenting to.' })
  version: string;

  @ApiProperty({ format: 'date-time' })
  effectiveFrom: Date;

  @ApiProperty({ enum: Locale, description: 'The translation actually returned.' })
  locale: Locale;

  @ApiProperty({ description: 'Markdown. Covers all five C-11 statements.' })
  body: string;

  @ApiProperty({ description: 'Short form shown above the fold.' })
  summary: string;

  @ApiProperty({ type: PolicyRetentionDto })
  retentionSummary: PolicyRetentionDto;
}

/**
 * `GET /settings/policy` — the whole row, both translations, for the admin editor.
 *
 * Separate from {@link PolicyResponseDto} on purpose: the consumer gate must never
 * receive the row id or the untranslated body, and an admin must never be handed a
 * locale-narrowed view of the text they are about to supersede.
 */
export class PolicyVersionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '2026.08.1' })
  version: string;

  @ApiProperty({ format: 'date-time' })
  effectiveFrom: Date;

  @ApiProperty({ description: 'Exactly one version is current at a time (§4.10).' })
  isCurrent: boolean;

  @ApiProperty()
  bodyEn: string;

  @ApiProperty()
  bodyUr: string;

  @ApiProperty()
  summaryEn: string;

  @ApiProperty()
  summaryUr: string;

  @ApiProperty({ type: PolicyRetentionDto })
  retentionSummary: PolicyRetentionDto;

  @ApiPropertyOptional({ format: 'date-time' })
  createdAt: Date;
}
