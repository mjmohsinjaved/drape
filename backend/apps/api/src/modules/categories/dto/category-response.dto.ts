import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * The **public** category node — `GET /categories` (A-6, C-1, C-17).
 *
 * Signed out and signed in return the same shape. What is *not* here matters more
 * than what is: no `archived`, no `parentId` bookkeeping, no
 * `publishedGarmentCount`, and no `coverImageKey` — a storage key never crosses the
 * network boundary (§3.4, E-12), only a signed, expiring URL does.
 *
 * `children` is present on top-level nodes and always empty on a child, because A-5
 * caps the taxonomy at one level of nesting.
 */
export class PublicCategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Bridal Lehenga' })
  name: string;

  @ApiPropertyOptional({ nullable: true, description: 'Urdu display name (C-41).' })
  nameUr: string | null;

  @ApiProperty({ example: 'bridal-lehenga' })
  slug: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Signed, expiring cover-image URL (A-6, §3.4).',
  })
  coverImageUrl: string | null;

  @ApiProperty({ description: 'Browse order (A-6). Ascending.', example: 0 })
  position: number;

  @ApiProperty({
    type: () => [PublicCategoryResponseDto],
    description: 'One level only (A-5). Always empty on a sub-category.',
  })
  children: PublicCategoryResponseDto[];
}

/**
 * The **admin** category node — `GET /admin/categories` (§5.5).
 *
 * A separate type from {@link PublicCategoryResponseDto} on purpose: the admin tree
 * carries archive state and the denormalised published-garment count that the A-7
 * delete guard reads, and neither has any business in a consumer response. Sharing
 * one DTO between the two surfaces is how a field leaks the day somebody adds it.
 */
export class AdminCategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Bridal Lehenga' })
  name: string;

  @ApiPropertyOptional({ nullable: true })
  nameUr: string | null;

  @ApiProperty({ example: 'bridal-lehenga' })
  slug: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'One level only (A-5).' })
  parentId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Signed, expiring cover-image URL (§3.4).' })
  coverImageUrl: string | null;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ description: 'A-7: an archived category is hidden, not deleted.' })
  archived: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  archivedAt: Date | null;

  @ApiProperty({
    description:
      'Denormalised count the A-7 delete guard reads. Non-zero means this category can ' +
      'only be archived.',
    example: 0,
  })
  publishedGarmentCount: number;

  @ApiProperty({
    description:
      'Published garments held by this category and, for a top-level node, by its ' +
      'sub-categories. This is the number the delete guard compares against.',
    example: 0,
  })
  publishedGarmentCountIncludingChildren: number;

  @ApiProperty({ description: 'Whether A-7 currently permits DELETE.' })
  deletable: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: () => [AdminCategoryResponseDto] })
  children: AdminCategoryResponseDto[];
}

/** `GET /admin/categories` — the full tree, archived nodes included on request (§5.5). */
export class AdminCategoryQueryDto {
  @ApiPropertyOptional({
    description: 'Include archived categories. Defaults to true — the admin tree is complete.',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @Transform(({ value }): boolean => value !== 'false' && value !== false)
  @IsBoolean()
  includeArchived: boolean = true;
}
