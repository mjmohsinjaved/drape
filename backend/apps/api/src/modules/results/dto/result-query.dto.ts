import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

/** The columns history may be sorted by. Narrowed per §2.8 — never interpolated. */
export const RESULT_SORT_KEYS = ['createdAt'] as const;

export type ResultSortKey = (typeof RESULT_SORT_KEYS)[number];

/**
 * `GET /results` — §5.12, C-25.
 *
 * Filters are deliberately limited to what the snapshot columns can answer without
 * joining `garments`: the photo the render came from (C-30) and a search over the
 * garment title as it was at the time. A `verdict` filter belongs to `shortlist`,
 * which owns the verdict (§4.20), and a live category filter belongs to `catalog`;
 * adding either here would mean history stopped rendering "exclusively from the
 * snapshots" (§4.18) and would break the moment a garment was removed.
 */
export class ResultQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only renders from this photo (C-30).' })
  @IsOptional()
  @IsUUID()
  personPhotoId?: string;

  @ApiPropertyOptional({ description: 'Substring match on the garment title snapshot.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiProperty({ enum: RESULT_SORT_KEYS, default: 'createdAt', required: false })
  @IsOptional()
  @IsIn(RESULT_SORT_KEYS)
  override sortBy: ResultSortKey = 'createdAt';
}
