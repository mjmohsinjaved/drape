import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { GarmentMode } from '../enums/garment-mode.enum';
import { PublishState } from '../enums/publish-state.enum';

/**
 * Sortable keys for `GET /admin/garments` — **PRD A-14**.
 *
 * > "…sort by newest, most tried, or highest star rate."
 *
 * `createdAt` is *newest*, `tryOnCount` is *most tried*, `starRate` is *highest star
 * rate*. The list is closed because `GarmentsService` maps each key to a SQL
 * fragment; a value outside it never reaches the query builder (§2.8).
 */
export const GARMENT_SORT_KEYS = [
  'createdAt',
  'updatedAt',
  'publishedAt',
  'tryOnCount',
  'starRate',
  'title',
  'price',
] as const;

export type GarmentSortKey = (typeof GARMENT_SORT_KEYS)[number];

/** `GET /admin/garments` — the catalog list (A-14, §5.6). */
export class GarmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive partial match on title, SKU or style tag.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined,
  )
  search?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Category filter (A-14).' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PublishState, description: 'Publish-state filter (A-14).' })
  @IsOptional()
  @IsEnum(PublishState)
  publishState?: PublishState;

  @ApiPropertyOptional({ enum: GarmentMode })
  @IsOptional()
  @IsEnum(GarmentMode)
  mode?: GarmentMode;

  @ApiPropertyOptional({
    description: 'Only pieces flagged by UPSTREAM_NO_GARMENT_DETECTED (A-15).',
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }): boolean => value === 'true' || value === true)
  @IsBoolean()
  flaggedForReview?: boolean;

  @ApiPropertyOptional({ enum: GARMENT_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(GARMENT_SORT_KEYS)
  override sortBy: string = 'createdAt';
}
