import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsIn, IsOptional } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';

/** Sortable columns for `GET /admin/consumers/:userId/shortlist`. */
export const ADMIN_SHORTLIST_SORTABLE_COLUMNS = ['rank', 'verdictAt', 'createdAt'] as const;

export class ConsumerShortlistQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_SHORTLIST_SORTABLE_COLUMNS, default: 'rank' })
  @IsOptional()
  @IsIn(ADMIN_SHORTLIST_SORTABLE_COLUMNS)
  override sortBy: string = 'rank';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'ASC' })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  override sortOrder: 'ASC' | 'DESC' = 'ASC';
}

/**
 * One shortlisted garment, as an admin sees it (A-17).
 *
 * `NOT_FOR_ME` rows never appear — they exist only for A-38 rejection analytics
 * (§4.20).
 *
 * **No render field.** The shortlist carries `latestResultId`, and following it here
 * would hand an admin a render she never attached to an enquiry, which is exactly
 * what S-10 forbids. Renders live on the enquiry-scoped route and nowhere else.
 */
export class ConsumerShortlistItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty()
  garmentTitle: string;

  @ApiProperty()
  garmentSku: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  garmentPrice: number | null;

  @ApiProperty({ example: 'PKR' })
  garmentCurrency: string;

  @ApiProperty({ enum: [Verdict.LOVE_IT, Verdict.MAYBE] })
  verdict: Verdict;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Her drag-to-rank order.' })
  rank: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  verdictAt: Date;
}
