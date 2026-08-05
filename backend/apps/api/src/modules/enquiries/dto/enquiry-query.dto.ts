import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { EnquiryStatus } from '../enums/enquiry-status.enum';

/** The columns `/enquiries` may be sorted by. §2.8: an allow-list, never interpolation. */
export const ENQUIRY_SORT_KEYS = ['createdAt', 'status'] as const;
export type EnquirySortKey = (typeof ENQUIRY_SORT_KEYS)[number];

/**
 * `GET /enquiries` — her own history (C-36, §5.15).
 *
 * Deliberately thin. She has a handful of enquiries, not a pipeline: a status filter
 * and a page is the whole requirement, and every field an admin filter offers is one
 * more shape to prove cannot cross accounts.
 */
export class EnquiryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EnquiryStatus })
  @IsOptional()
  @IsEnum(EnquiryStatus)
  status?: EnquiryStatus;

  @ApiPropertyOptional({ enum: ENQUIRY_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ENQUIRY_SORT_KEYS)
  override sortBy: string = 'createdAt';
}

/**
 * `GET /admin/enquiries` — the inbox (A-25, §5.15).
 *
 * > "Inbox with status filter, stale-after-24 h flag and search."
 *
 * `stale=true` is a filter over "untouched after 24 hours", which is
 * `firstRespondedAt IS NULL` plus an age — the partial index in §4.23 exists for it.
 * Search spans the reference, the consumer's name and her email, because those are the
 * three things an admin has in front of them when a consumer calls.
 */
export class AdminEnquiryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EnquiryStatus })
  @IsOptional()
  @IsEnum(EnquiryStatus)
  status?: EnquiryStatus;

  @ApiPropertyOptional({
    description: 'Only enquiries untouched for more than 24 hours (A-25).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  stale?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only enquiries assigned to this admin.' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ description: 'Reference, consumer name or email.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: ENQUIRY_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ENQUIRY_SORT_KEYS)
  override sortBy: string = 'createdAt';
}
