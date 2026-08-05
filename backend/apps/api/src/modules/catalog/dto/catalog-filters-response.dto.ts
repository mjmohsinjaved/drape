import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { EmbellishmentWeight } from '@api/modules/garments/enums/embellishment-weight.enum';
import { GarmentMode } from '@api/modules/garments/enums/garment-mode.enum';

/** One selectable facet value and how many visible garments carry it. */
export class CatalogFacetDto {
  @ApiProperty({ description: 'The value to send back as a filter.', example: 'maroon' })
  value: string;

  @ApiPropertyOptional({ nullable: true, description: 'Display label where it differs.' })
  label: string | null;

  @ApiProperty({ description: 'Visible garments carrying this value.', example: 12 })
  count: number;
}

/** The price band bounds, in the catalogue's currency. */
export class CatalogPriceRangeDto {
  @ApiProperty({ example: 45000 })
  min: number;

  @ApiProperty({ example: 850000 })
  max: number;

  @ApiProperty({ example: 'PKR' })
  currency: string;
}

/**
 * `GET /catalog/filters` — **"available filter facets with counts, so the UI never
 * offers an empty filter"** (§5.8, C-17).
 *
 * Every count is computed over the *visible* catalogue — the same
 * published-and-test-render-approved predicate the grid uses — so a facet can never
 * advertise a garment the grid would refuse to show.
 *
 * `priceRange` is `null` while `catalog.showPricesPublicly` is off (A-30). Returning
 * bounds would be a price disclosure: the toggle is about what a visitor can learn
 * about prices, not about which field carries it.
 */
export class CatalogFiltersResponseDto {
  @ApiProperty({ type: [CatalogFacetDto], description: 'Colour facets (C-17).' })
  colors: CatalogFacetDto[];

  @ApiProperty({ type: [CatalogFacetDto], description: 'Size facets (C-17).' })
  sizes: CatalogFacetDto[];

  @ApiProperty({
    type: [CatalogFacetDto],
    description: `Embellishment weight facets. Values are members of ${Object.values(
      EmbellishmentWeight,
    ).join(' | ')} (C-17).`,
  })
  embellishmentWeights: CatalogFacetDto[];

  @ApiProperty({
    type: [CatalogFacetDto],
    description: `Rental or sale. Values are members of ${Object.values(GarmentMode).join(' | ')}.`,
  })
  modes: CatalogFacetDto[];

  @ApiProperty({
    type: [CatalogFacetDto],
    description: 'Categories that currently hold a visible garment. `value` is the category id.',
  })
  categories: CatalogFacetDto[];

  @ApiPropertyOptional({
    type: CatalogPriceRangeDto,
    nullable: true,
    description: 'Null while `catalog.showPricesPublicly` is off (A-30).',
  })
  priceRange: CatalogPriceRangeDto | null;
}
