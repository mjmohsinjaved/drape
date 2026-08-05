import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EmbellishmentWeight } from '@api/modules/garments/enums/embellishment-weight.enum';
import { GarmentMode } from '@api/modules/garments/enums/garment-mode.enum';

/** One gallery image, as a signed and expiring URL pair (§3.4, D-20 alt text). */
export class PublicGarmentImageDto {
  @ApiProperty({ description: 'Signed, expiring full-size URL.' })
  url: string;

  @ApiPropertyOptional({ nullable: true, description: 'Signed, expiring thumbnail URL.' })
  thumbnailUrl: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'D-20 alt text.' })
  altText: string | null;

  @ApiProperty({ example: 0 })
  position: number;
}

/**
 * The **public** garment card — `GET /catalog/garments` and `/catalog/new-arrivals`
 * (C-1, C-17).
 *
 * A separate type from `GarmentResponseDto`, not a subset of it. Everything an admin
 * needs and a visitor must not see — `sku`, `publishState`, `qualityScore`,
 * `qualityChecks`, `testRenderState`, `flaggedForReview`, `failureCount`, the
 * engagement counters — is **absent from this class**, so there is no field to blank
 * out and no blanking to forget. A shared DTO with admin fields nulled is one careless
 * mapper edit away from leaking them.
 *
 * `price`, `currency` and `deposit` are nullable for a different reason: A-30's
 * `catalog.showPricesPublicly` toggle. When it is off the mapper leaves all three
 * null on every public response, and a test asserts it.
 */
export class PublicGarmentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'zarrin-bridal-lehenga' })
  slug: string;

  @ApiProperty({ example: 'Zarrin Bridal Lehenga' })
  title: string;

  @ApiPropertyOptional({ nullable: true, description: 'Urdu title (C-41).' })
  titleUr: string | null;

  @ApiProperty({ format: 'uuid' })
  categoryId: string;

  @ApiPropertyOptional({ nullable: true })
  categoryName: string | null;

  @ApiPropertyOptional({ nullable: true })
  categorySlug: string | null;

  @ApiProperty({ type: [String], example: ['maroon', 'gold'] })
  colors: string[];

  @ApiProperty({ enum: EmbellishmentWeight })
  embellishmentWeight: EmbellishmentWeight;

  @ApiProperty({ type: [String], example: ['S', 'M', 'L'] })
  sizes: string[];

  @ApiProperty({ enum: GarmentMode })
  mode: GarmentMode;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null whenever `catalog.showPricesPublicly` is off (A-30).',
    example: 185000,
  })
  price: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Null alongside a null price (A-30).' })
  currency: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Rental deposit. Null on a sale, and null whenever prices are hidden (A-30).',
  })
  deposit: number | null;

  @ApiPropertyOptional({ type: PublicGarmentImageDto, nullable: true })
  primaryImage: PublicGarmentImageDto | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  publishedAt: Date | null;
}

/** `GET /catalog/garments/:slugOrId` — gallery, price, fabric, sizes (C-18). */
export class PublicGarmentDetailDto extends PublicGarmentSummaryDto {
  @ApiPropertyOptional({ nullable: true, example: 'Raw silk' })
  fabric: string | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Urdu description (C-41).' })
  descriptionUr: string | null;

  @ApiProperty({ type: [String], description: 'Searchable style tags (C-17).' })
  styleTags: string[];

  @ApiProperty({ type: [PublicGarmentImageDto], description: 'Gallery order (C-18).' })
  images: PublicGarmentImageDto[];
}
