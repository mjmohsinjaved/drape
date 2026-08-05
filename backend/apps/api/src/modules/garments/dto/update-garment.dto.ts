import { ApiPropertyOptional } from '@nestjs/swagger';

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

import {
  MAX_COLORS,
  MAX_PRICE,
  MAX_SIZES,
  MAX_STYLE_TAGS,
  normalisedSizes,
  normalisedTags,
} from './create-garment.dto';

const trimmed = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * `PATCH /admin/garments/:garmentId` (§5.6).
 *
 * Every field is optional and **absent means unchanged**, so the nullable fields use
 * `@ValidateIf(value !== null)` rather than `@IsOptional()`: `@IsOptional()` treats
 * `null` as "not supplied", and clearing a fabric or a deposit is a real edit.
 *
 * `deposit` cannot be validated against `mode` here — a PATCH may change `mode`
 * without sending `deposit`, or the reverse. The rental/deposit rule is therefore
 * enforced by `GarmentsService` against the **merged** record, which is the only
 * place that knows both values.
 */
export class UpdateGarmentDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(trimmed)
  sku?: string;

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  @Transform(trimmed)
  title?: string;

  @ApiPropertyOptional({ maxLength: 160, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(160)
  titleUr?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_GARMENT_SLUG_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GARMENT_SLUG_LENGTH)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by single hyphens',
  })
  @Transform(trimmed)
  slug?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Re-categorise. When the garment is published, the A-7 counters on both ' +
      'categories move inside the same transaction.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_COLORS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLORS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Transform(normalisedTags)
  colors?: string[];

  @ApiPropertyOptional({ maxLength: 80, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fabric?: string | null;

  @ApiPropertyOptional({ enum: EmbellishmentWeight })
  @IsOptional()
  @IsEnum(EmbellishmentWeight)
  embellishmentWeight?: EmbellishmentWeight;

  @ApiPropertyOptional({ example: 185000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  @ApiPropertyOptional({ example: 'PKR' })
  @IsOptional()
  @IsISO4217CurrencyCode()
  currency?: string;

  @ApiPropertyOptional({ enum: GarmentMode })
  @IsOptional()
  @IsEnum(GarmentMode)
  mode?: GarmentMode;

  @ApiPropertyOptional({
    description: 'Required while `mode = RENTAL`; must be `null` on a sale (§4.13).',
    nullable: true,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_PRICE)
  deposit?: number | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  descriptionUr?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_SIZES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SIZES)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  @Transform(normalisedSizes)
  sizes?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: MAX_STYLE_TAGS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STYLE_TAGS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Transform(normalisedTags)
  styleTags?: string[];
}
