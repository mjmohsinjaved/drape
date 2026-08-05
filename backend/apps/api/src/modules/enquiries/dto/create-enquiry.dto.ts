import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';
import { EventType } from '@api/modules/users/enums/event-type.enum';

import { MAX_ENQUIRY_MESSAGE_LENGTH } from '../constants/enquiry.constants';

/**
 * `POST /enquiries` — submit (C-35, §5.15).
 *
 * > C-35: "Enquiry: shortlist plus event date, event type, budget band and a message,
 * > with profile details pre-filled."
 *
 * **There is no item list here.** The enquiry snapshots her shortlist as it stands at
 * submission (A-21), in her rank order — sending ids would let a client submit pieces
 * she has not shortlisted, or miss ones she has, and would make the snapshot a
 * negotiation rather than a record.
 *
 * The three event fields are optional *in the payload* because they are pre-filled
 * from `consumer_profiles`: omitting one means "use what my profile says", not "leave
 * it blank". `EnquiriesService` fills each gap from her profile before writing.
 */
export class CreateEnquiryDto {
  @ApiProperty({
    maxLength: MAX_ENQUIRY_MESSAGE_LENGTH,
    example: 'I would like to see these in person. Which are available in my size?',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ENQUIRY_MESSAGE_LENGTH)
  message: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-12-14',
    description: 'A true calendar date (§4.0 rule 2). Defaults to the date on her profile.',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  eventDate?: string;

  @ApiPropertyOptional({ enum: EventType, description: 'Defaults to the type on her profile.' })
  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType;

  @ApiPropertyOptional({ enum: BudgetBand, description: 'Defaults to the band on her profile.' })
  @IsOptional()
  @IsEnum(BudgetBand)
  budgetBand?: BudgetBand;
}
