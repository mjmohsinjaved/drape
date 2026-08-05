import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/**
 * Bounds for A-18. A negative allowance is meaningless and an unbounded one is a
 * budget hole, so both ends are closed; `QUOTA_ADJUSTMENT_INVALID` reports them
 * back to the console verbatim.
 */
export const MIN_QUOTA_OVERRIDE = 0;
export const MAX_QUOTA_OVERRIDE = 1000;

/**
 * `PATCH /admin/consumers/:userId/quota` — set or clear `monthlyQuotaOverride`
 * (A-18).
 *
 * `null` clears the override and returns the account to
 * `settings['quota.defaultMonthly']`. **This endpoint only writes the field.** The
 * arithmetic that turns it into a balance — the lazy `MONTHLY_GRANT`, the
 * mid-period `OVERRIDE_GRANT` for the difference — belongs to the `quota` module and
 * its append-only ledger (§4.26). There is no balance column here to get wrong.
 */
export class SetQuotaOverrideDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: MIN_QUOTA_OVERRIDE,
    maximum: MAX_QUOTA_OVERRIDE,
    description: 'Monthly generations for this account. `null` restores the global default.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(MIN_QUOTA_OVERRIDE)
  @Max(MAX_QUOTA_OVERRIDE)
  monthlyQuotaOverride: number | null = null;
}
