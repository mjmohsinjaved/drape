import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

import { BudgetBand } from '../enums/budget-band.enum';
import { EventType } from '../enums/event-type.enum';

/** A shortlist of favourite categories, not a second catalogue. */
export const MAX_PREFERRED_CATEGORIES = 12;

/**
 * `PATCH /me/profile` (C-2).
 *
 * > "Signup requires name, email, password and phone. Event date, event type and
 * > budget band are **optional** and prompted later in context."
 *
 * So every field here is optional in two senses: it may be omitted from the payload,
 * and it may be sent as `null` to clear a value she would rather not share. Neither
 * is an error, and nothing downstream may treat a null here as incomplete onboarding.
 *
 * `monthlyQuotaOverride` is **not** writable here. It is an admin control (A-18) and
 * a self-service route that touched it would be a straightforward privilege
 * escalation.
 */
export class UpdateConsumerProfileDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-01-14',
    description: 'A true calendar date (§4.0 rule 2), not a timestamp.',
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsDateString({ strict: false })
  eventDate?: string | null;

  @ApiPropertyOptional({ enum: EventType, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsEnum(EventType)
  eventType?: EventType | null;

  @ApiPropertyOptional({ enum: BudgetBand, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsEnum(BudgetBand)
  budgetBand?: BudgetBand | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_PREFERRED_CATEGORIES,
    description: 'Category ids. An empty array clears the list.',
  })
  @IsOptional()
  @Transform(({ value }): unknown => (value === null ? [] : value))
  @IsArray()
  @ArrayMaxSize(MAX_PREFERRED_CATEGORIES)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  preferredCategories?: string[];
}

/** `GET /me/profile` (C-2). */
export class ConsumerProfileResponseDto {
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  eventDate: string | null;

  @ApiPropertyOptional({ enum: EventType, nullable: true })
  eventType: EventType | null;

  @ApiPropertyOptional({ enum: BudgetBand, nullable: true })
  budgetBand: BudgetBand | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  preferredCategories: string[];

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Read-only here. Null means the global default applies; only an admin can set it (A-18).',
  })
  monthlyQuotaOverride: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  onboardingCompletedAt: Date | null;
}
