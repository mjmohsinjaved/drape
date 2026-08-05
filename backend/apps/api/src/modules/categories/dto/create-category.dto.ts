import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MAX_CATEGORY_SLUG_LENGTH } from '../utils/slug.util';

/** Trims a string field and turns `''` into `undefined` so `@IsOptional()` sees it. */
const trimmed = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * `POST /admin/categories` — A-4, A-5, A-6.
 *
 * `parentId` is the only field with a rule the DTO cannot express: one level of
 * nesting (A-5) depends on the *parent's* own `parentId`, so it is enforced in
 * `CategoriesService` with `CATEGORY_DEPTH_EXCEEDED`.
 */
export class CreateCategoryDto {
  @ApiProperty({ description: 'Display name (A-6).', maxLength: 80, example: 'Bridal Lehenga' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(trimmed)
  name: string;

  @ApiPropertyOptional({ description: 'Urdu display name (C-41).', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trimmed)
  nameUr?: string;

  @ApiPropertyOptional({
    description:
      'URL slug. Derived from `name` when omitted, and de-duplicated with a numeric ' +
      'suffix if it is already taken.',
    maxLength: MAX_CATEGORY_SLUG_LENGTH,
    example: 'bridal-lehenga',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CATEGORY_SLUG_LENGTH)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase alphanumeric words separated by single hyphens',
  })
  @Transform(trimmed)
  slug?: string;

  @ApiPropertyOptional({
    description:
      'Parent category. Sub-categories go exactly one level deep (A-5) — a parent that ' +
      'already has a parent is refused with CATEGORY_DEPTH_EXCEEDED.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    description: 'Storage key of the cover image (A-6). Never returned; a signed URL is.',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Transform(trimmed)
  coverImageKey?: string;

  @ApiPropertyOptional({
    description: 'Sort position (A-6). Appended to the end of its sibling set when omitted.',
    minimum: 0,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
