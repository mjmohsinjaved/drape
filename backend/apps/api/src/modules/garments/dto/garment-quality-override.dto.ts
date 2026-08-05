import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Long enough that "ok" is not a reason. */
export const MIN_OVERRIDE_REASON_LENGTH = 10;

/**
 * `POST /admin/garments/:garmentId/quality-override` — **A-10**.
 *
 * > "…override with a required reason; audit-logged."
 *
 * The reason is required by the API, not by the form, and it is what the
 * `GARMENT_QUALITY_OVERRIDDEN` audit row carries. An override with no reason is an
 * audit row that says a rule was bypassed and cannot say why, which is the one thing
 * an audit trail exists to prevent.
 *
 * Recording the override does not publish anything. It removes the A-10 objection so
 * that a subsequent `POST …/publish` can proceed; the A-11 test-render gate is
 * untouched and still applies.
 */
export class GarmentQualityOverrideDto {
  @ApiProperty({
    description: 'Why this piece may go live below the quality threshold. Audit-logged (A-10).',
    minLength: MIN_OVERRIDE_REASON_LENGTH,
    maxLength: 500,
    example: 'Archive piece — the only surviving photograph, reshoot not possible.',
  })
  @IsString()
  @MinLength(MIN_OVERRIDE_REASON_LENGTH)
  @MaxLength(500)
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  reason: string;
}
