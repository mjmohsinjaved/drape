import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { SettingsValueType } from '../enums/settings-value-type.enum';

/** One registry-backed setting, as `GET /settings` (ADMIN) returns it. */
export class SettingResponseDto {
  @ApiProperty({ example: 'quota.defaultMonthly' })
  key: string;

  @ApiProperty({
    description: 'The stored value, or the registry default when no row exists yet.',
    example: 15,
  })
  value: unknown;

  @ApiProperty({ enum: SettingsValueType })
  valueType: SettingsValueType;

  @ApiProperty({ example: 'Default monthly generation quota per consumer.' })
  description: string;

  @ApiProperty({ description: 'Exposed by GET /settings/brand.' })
  isPublic: boolean;

  @ApiProperty({ description: 'The PRD requirement this key serves.', example: 'A-28, C-5' })
  requirement: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'The admin who last changed it. Null while the seeded value stands.',
  })
  updatedBy: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  updatedAt: Date | null;
}

/**
 * A-29 — the monthly system budget expressed the way every caller needs it.
 *
 * The two thresholds are **derived here, once**, rather than recomputed at each call
 * site: a soft warning at `warnThresholdPercent` and a hard stop at 100%. W3's
 * generation path compares the derived `usage_ledger` total against `hardStopAt`;
 * E-14's alert fires when it first crosses `warnAt`.
 */
export class BudgetPolicyResponseDto {
  @ApiProperty({ example: 2000, description: 'The monthly ceiling (A-29).' })
  monthlyGenerations: number;

  @ApiProperty({ example: 80 })
  warnThresholdPercent: number;

  @ApiProperty({ example: 1600, description: 'Generations at which the soft warning fires.' })
  warnAt: number;

  @ApiProperty({ example: 2000, description: 'Generations at which the hard stop applies.' })
  hardStopAt: number;
}
