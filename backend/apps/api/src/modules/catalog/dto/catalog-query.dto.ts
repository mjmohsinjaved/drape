import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '@library/common';

import { EmbellishmentWeight } from '@api/modules/garments/enums/embellishment-weight.enum';
import { GarmentMode } from '@api/modules/garments/enums/garment-mode.enum';

/** Sort options §5.8 specifies for the public grid. */
export const CATALOG_SORTS = ['newest', 'mostTried', 'priceAsc', 'priceDesc'] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** How many new arrivals a single call may ask for (C-8). */
export const MAX_NEW_ARRIVALS = 48;
export const DEFAULT_NEW_ARRIVALS = 12;

const trimmed = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const lowerTrimmed = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : undefined;

/**
 * `GET /catalog/garments` — **C-1, C-17**.
 *
 * > C-17: "Browse by category, then a grid filtered by color, price band,
 * > embellishment weight and size. Search across title, category, color and style tags."
 *
 * `sortBy` is narrowed to the four §5.8 keys. Each one maps to a SQL fragment in
 * `CatalogService`; a value outside the list never reaches the query builder (§2.8).
 * `sortOrder` is inherited from `PaginationQueryDto` and deliberately ignored — the
 * direction is part of the sort's meaning ("newest", "priceAsc"), and a `sortOrder`
 * that could invert it would make `?sortBy=priceAsc&sortOrder=DESC` a question with
 * no sensible answer.
 *
 * `priceMin` / `priceMax` are the C-17 price band. Both are **ignored** while
 * `catalog.showPricesPublicly` is off (A-30): the toggle exists so prices are not
 * public, and a filter that narrows results by price leaks them a binary search at a
 * time.
 */
export class CatalogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search across title, category name, colour and style tags (C-17).',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimmed)
  search?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Category filter. A top-level category includes its sub-categories, so browsing ' +
      '"Bridal" does not hide the pieces filed under "Bridal › Lehenga" (A-5, C-17).',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Colour facet (C-17).', example: 'maroon', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(lowerTrimmed)
  color?: string;

  @ApiPropertyOptional({ description: 'Size facet (C-17).', example: 'M', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase() : undefined,
  )
  size?: string;

  @ApiPropertyOptional({ enum: EmbellishmentWeight, description: 'Embellishment weight (C-17).' })
  @IsOptional()
  @IsEnum(EmbellishmentWeight)
  embellishmentWeight?: EmbellishmentWeight;

  @ApiPropertyOptional({ enum: GarmentMode })
  @IsOptional()
  @IsEnum(GarmentMode)
  mode?: GarmentMode;

  @ApiPropertyOptional({ description: 'Lower bound of the price band (C-17).', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({ description: 'Upper bound of the price band (C-17).', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({ enum: CATALOG_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(CATALOG_SORTS)
  override sortBy: string = 'newest';
}

/** `GET /catalog/new-arrivals` — recently published (C-8, §5.8). */
export class NewArrivalsQueryDto {
  @ApiPropertyOptional({
    description: 'Scope to one category and its sub-categories.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    default: DEFAULT_NEW_ARRIVALS,
    minimum: 1,
    maximum: MAX_NEW_ARRIVALS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_NEW_ARRIVALS)
  limit: number = DEFAULT_NEW_ARRIVALS;
}

/**
 * `GET /catalog/garments/:slugOrId` (C-18).
 *
 * One parameter that accepts either form, because §5.8 says so: the web app links by
 * slug and the API's own responses carry ids. The pattern admits both and nothing
 * else, so a malformed value is a §2.3 validation error rather than a database round
 * trip.
 */
export class GarmentSlugParamDto {
  @ApiProperty({
    description: 'The garment slug, or its uuid.',
    example: 'zarrin-bridal-lehenga',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i, {
    message: 'slugOrId must be a slug or a uuid',
  })
  slugOrId: string;
}
