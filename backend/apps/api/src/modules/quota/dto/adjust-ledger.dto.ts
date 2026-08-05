import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsInt, IsOptional, IsString, Max, MaxLength, Min, NotEquals } from 'class-validator';

/** Bounds for a single manual adjustment. Wide enough to be useful, narrow enough to review. */
export const MIN_LEDGER_ADJUSTMENT = -1000;
export const MAX_LEDGER_ADJUSTMENT = 1000;

/** `note` is `varchar(255)` on both ledgers (§4.26, §4.27). */
export const MAX_ADJUSTMENT_NOTE_LENGTH = 255;

/**
 * `POST /admin/consumers/:userId/quota-adjust` (A-18) and
 * `POST /admin/usage/adjust` (A-29, §5.16).
 *
 * **A delta, never a target.** Both ledgers are append-only: correcting a balance
 * means appending a compensating row, not restating the total (§2.1). A DTO that
 * carried "set the remaining quota to 20" would force the service to read a balance,
 * compute a difference and write it — a read-then-write over a value another request
 * may be changing, which is the precise shape this module exists to avoid. Asking for
 * the delta directly makes the admin's intent unambiguous and the write a pure insert.
 *
 * `@NotEquals(0)` because a zero-delta row records nothing and reads, in the A-18
 * ledger view, as an adjustment that did something.
 */
export class AdjustLedgerDto {
  @ApiProperty({
    example: 10,
    minimum: MIN_LEDGER_ADJUSTMENT,
    maximum: MAX_LEDGER_ADJUSTMENT,
    description: 'Generations to add (positive) or remove (negative). Never a new total.',
  })
  @IsInt()
  @Min(MIN_LEDGER_ADJUSTMENT)
  @Max(MAX_LEDGER_ADJUSTMENT)
  @NotEquals(0)
  delta: number;

  @ApiPropertyOptional({
    example: 'Raised for an upcoming event.',
    maxLength: MAX_ADJUSTMENT_NOTE_LENGTH,
    description: 'Why. Shown in the ledger view and copied into the audit row (A-3).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ADJUSTMENT_NOTE_LENGTH)
  note?: string;
}
