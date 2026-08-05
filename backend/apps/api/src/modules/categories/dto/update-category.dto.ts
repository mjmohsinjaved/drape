import { ApiPropertyOptional } from '@nestjs/swagger';

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
  ValidateIf,
} from 'class-validator';

import { MAX_CATEGORY_SLUG_LENGTH } from '../utils/slug.util';

const trimmed = ({ value }: { value: unknown }): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * `PATCH /admin/categories/:categoryId` — rename, re-parent, set cover image (§5.5).
 *
 * `parentId` accepts `null` explicitly, which is how a sub-category is promoted back
 * to the top level. That is why it is `@ValidateIf(value !== null)` rather than
 * `@IsOptional()`: `@IsOptional()` treats `null` as "not supplied" and would silently
 * swallow the promotion.
 *
 * `coverImageKey` accepts `null` for the same reason — clearing a cover image is a
 * real edit, not an omission.
 */
export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Display name (A-6).', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(trimmed)
  name?: string;

  @ApiPropertyOptional({ description: 'Urdu display name (C-41).', maxLength: 80, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nameUr?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_CATEGORY_SLUG_LENGTH })
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
      'New parent, or `null` to promote this category back to the top level. One level ' +
      'of nesting only (A-5).',
    format: 'uuid',
    nullable: true,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({
    description: 'Storage key of the cover image (A-6), or `null` to clear it.',
    maxLength: 512,
    nullable: true,
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(512)
  coverImageKey?: string | null;

  @ApiPropertyOptional({
    description:
      'Sort position (A-6). Prefer POST /admin/categories/reorder, which renumbers a ' +
      'whole sibling set atomically.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
