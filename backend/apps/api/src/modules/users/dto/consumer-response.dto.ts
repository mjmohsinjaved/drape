import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Locale, UserStatus } from '@library/common';

import { EnquiryStatus } from '@api/modules/enquiries/enums/enquiry-status.enum';

import { BudgetBand } from '../enums/budget-band.enum';
import { EventType } from '../enums/event-type.enum';

/**
 * One row of `GET /admin/consumers` — exactly the nine facts A-16 asks for:
 * name, email, phone, signup date, last active, generations used this month,
 * shortlist size, enquiry count, status.
 *
 * A-16 is what authorises email and phone to appear in an admin list. Nothing else
 * about the account does, and no other consumer-shaped list DTO in this module
 * carries them.
 */
export class ConsumerListItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Authorised for the admin list by A-16.' })
  email: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'E.164. A-16.' })
  phone: string | null;

  @ApiProperty({ format: 'date-time', description: 'Signup date.' })
  signedUpAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastActiveAt: Date | null;

  @ApiProperty({
    description:
      'Generations consumed in the current `Asia/Karachi` period, derived from `quota_ledger`.',
  })
  generationsThisMonth: number;

  @ApiProperty({ description: 'Loves and maybes. Rejections are excluded (§4.20).' })
  shortlistSize: number;

  @ApiProperty()
  enquiryCount: number;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;
}

/** The consumer's own profile fields, as an admin sees them (A-17, A-18). */
export class ConsumerProfileSummaryDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-01-14',
    description: 'A calendar date, never an instant — a timezone must not move her wedding.',
  })
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
    description: 'A-18. Null means the global `quota.defaultMonthly` applies.',
  })
  monthlyQuotaOverride: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  onboardingCompletedAt: Date | null;
}

/** One enquiry in the A-17 enquiry history. */
export class ConsumerEnquirySummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ENQ-2026-000137' })
  reference: string;

  @ApiProperty({ enum: EnquiryStatus })
  status: EnquiryStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  firstRespondedAt: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  closedAt: Date | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  totalValueSnapshot: number | null;
}

/**
 * `GET /admin/consumers/:userId` — consumer detail (A-17).
 *
 * **There is no field on this class for a person photo, and there never will be**
 * (S-10). The query that fills it is built without a `person_photos` repository, so
 * the omission is structural rather than a mapper choosing to leave something out.
 * Renders are not here either: they live on
 * `GET /admin/consumers/:userId/renders`, which reaches them only through
 * `enquiry_items`.
 */
export class ConsumerDetailResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'A-19 requires a reason on suspension.',
  })
  suspendedReason: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  suspendedAt: Date | null;

  @ApiProperty()
  emailVerified: boolean;

  @ApiProperty()
  phoneVerified: boolean;

  @ApiProperty({ enum: Locale })
  locale: Locale;

  @ApiProperty({ format: 'date-time' })
  signedUpAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastActiveAt: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastLoginAt: Date | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set once deletion is requested; the purge completes within DELETION_SLA_HOURS.',
  })
  deletionRequestedAt: Date | null;

  @ApiProperty({ type: ConsumerProfileSummaryDto })
  profile: ConsumerProfileSummaryDto;

  @ApiProperty()
  generationsThisMonth: number;

  @ApiProperty()
  shortlistSize: number;

  @ApiProperty()
  enquiryCount: number;

  @ApiProperty({ type: [ConsumerEnquirySummaryDto], description: 'Enquiry history (A-17).' })
  enquiries: ConsumerEnquirySummaryDto[];
}
