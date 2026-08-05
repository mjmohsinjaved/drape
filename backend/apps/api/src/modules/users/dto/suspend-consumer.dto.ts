import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Shortest reason that can carry any meaning. A-19 makes the field required. */
export const MIN_SUSPENSION_REASON_LENGTH = 10;
export const MAX_SUSPENSION_REASON_LENGTH = 1000;

/**
 * `POST /admin/consumers/:userId/suspend` (A-19).
 *
 * > "Suspend an account with a required reason. Suspension blocks generation and
 * > enquiry but preserves data pending review."
 *
 * The reason is required by validation, not by convention: it is stored on
 * `users.suspendedReason`, shown to the consumer in the `ACCOUNT_SUSPENDED` email,
 * and read back by whoever reviews the hold weeks later. "Required" is doing real
 * work here, so an empty or whitespace string is a validation error.
 */
export class SuspendConsumerDto {
  @ApiProperty({
    minLength: MIN_SUSPENSION_REASON_LENGTH,
    maxLength: MAX_SUSPENSION_REASON_LENGTH,
    description: 'Why the account is on hold. Shown to the consumer (A-19, D-7).',
  })
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(MIN_SUSPENSION_REASON_LENGTH)
  @MaxLength(MAX_SUSPENSION_REASON_LENGTH)
  reason: string;
}
