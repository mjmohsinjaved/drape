import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { EmbellishmentWeight } from '../enums/embellishment-weight.enum';
import { GarmentMode } from '../enums/garment-mode.enum';
import { MAX_GARMENT_SLUG_LENGTH } from '../utils/slug.util';

/** `decimal(18,2)` — the schema ceiling, not a business one (§2.1). */
export const MAX_PRICE = 9_999_999_999.99;

/** Bounds on the free-form text arrays, so one payload cannot carry a novel. */
export const MAX_COLORS = 12;
export const MAX_SIZES = 20;
export const MAX_STYLE_TAGS = 20;

const trimmed = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Trims, de-duplicates and applies `normalise` to every member of a string array. */
const tagArray =
  (normalise: (entry: string) => string) =>
  ({ value }: { value: unknown }): string[] | undefined => {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const cleaned = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalise(entry.trim()))
      .filter((entry) => entry !== '');
    return [...new Set(cleaned)];
  };

/**
 * Colours and style tags are case-folded so `Gold` and `gold` are one facet — C-17
 * filters on them, and two spellings of one colour is two half-empty filter chips.
 */
export const normalisedTags = tagArray((entry) => entry.toLowerCase());

/**
 * Sizes are case-folded **up**, not down: the catalogue's sizes are `S`, `M`, `XL`,
 * and a lower-cased size filter reads as a typo on the browse screen.
 */
export const normalisedSizes = tagArray((entry) => entry.toUpperCase());

/**
 * `POST /admin/garments` — **PRD A-8**, every field it names.
 *
 * > "Create a garment with: title, SKU, category, colors, fabric, embellishment
 * > weight (light / medium / heavy), price, rental or sale, deposit if rental,
 * > description, sizes available."
 *
 * One rule cannot be expressed field-by-field: **a deposit is only meaningful for a
 * rental**. `@ValidateIf` makes it required when `mode = RENTAL`, and
 * `GarmentsService` re-checks the *merged* record on every write — a PATCH that
 * flips `mode` alone never reaches this class, so the DTO alone would let a sale
 * keep a stale deposit.
 */
export class CreateGarmentDto {
  @ApiProperty({ description: 'Stock-keeping unit. Unique across live garments.', maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(trimmed)
  sku: string;

  @ApiProperty({ maxLength: 160, example: 'Zarrin Bridal Lehenga' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Transform(trimmed)
  title: string;

  @ApiPropertyOptional({ description: 'Urdu title (C-41).', maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trimmed)
  titleUr?: string;

  @ApiPropertyOptional({
    description: 'URL slug. Derived from `title` when omitted, de-duplicated if taken.',
    maxLength: MAX_GARMENT_SLUG_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GARMENT_SLUG_LENGTH)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by single hyphens',
  })
  @Transform(trimmed)
  slug?: string;

  @ApiProperty({ format: 'uuid', description: 'Must exist and not be archived (A-7).' })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_COLORS, example: ['maroon', 'gold'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLORS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Transform(normalisedTags)
  colors?: string[];

  @ApiPropertyOptional({ maxLength: 80, example: 'Raw silk' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trimmed)
  fabric?: string;

  @ApiProperty({ enum: EmbellishmentWeight, description: 'Light / medium / heavy (A-8).' })
  @IsEnum(EmbellishmentWeight)
  embellishmentWeight: EmbellishmentWeight;

  @ApiProperty({ description: 'Major units, two decimal places.', example: 185000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  price: number;

  @ApiPropertyOptional({ description: 'ISO-4217 code. Defaults to PKR.', default: 'PKR' })
  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @ApiProperty({ enum: GarmentMode, description: 'Rental or sale (A-8).' })
  @IsEnum(GarmentMode)
  mode: GarmentMode;

  @ApiPropertyOptional({
    description: 'Required when `mode = RENTAL`, and refused otherwise (A-8, §4.13).',
    example: 45000,
  })
  @ValidateIf((dto: CreateGarmentDto) => dto.mode === GarmentMode.RENTAL)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  deposit?: number;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(trimmed)
  description?: string;

  @ApiPropertyOptional({ maxLength: 4000, description: 'Urdu description (C-41).' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(trimmed)
  descriptionUr?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_SIZES, example: ['S', 'M', 'L'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SIZES)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  @Transform(normalisedSizes)
  sizes?: string[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_STYLE_TAGS,
    description: 'Feeds the C-17 search index.',
    example: ['bridal', 'traditional'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STYLE_TAGS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Transform(normalisedTags)
  styleTags?: string[];
}
