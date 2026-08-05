import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  ApiStandardResponses,
  Public,
  ResponseMessage,
  Role,
  Roles,
  type IPaginated,
} from '@library/common';

import { CatalogFiltersResponseDto } from '../dto/catalog-filters-response.dto';
import {
  CatalogQueryDto,
  GarmentSlugParamDto,
  NewArrivalsQueryDto,
} from '../dto/catalog-query.dto';
import {
  PublicGarmentDetailDto,
  PublicGarmentSummaryDto,
} from '../dto/public-garment-response.dto';
import { CatalogService } from '../services/catalog.service';

/**
 * Public browse — ARCHITECTURE §5.8, PRD C-1, C-8, C-17, C-18.
 *
 * > C-1: "Browsing is public. Catalog, categories, search, filters and garment detail
 * > are reachable while signed out. Only actions involving her photo require an account."
 *
 * So **every handler here is `@Public()` + `@Roles(Role.PUBLIC)` + an explicit
 * `@Throttle()`**, exactly as §2.6 requires. `@Public()` bypasses `SessionAuthGuard`
 * and nothing else — CSRF and the throttler still run, and the spec beside this file
 * asserts the three decorators are present on each route rather than trusting them to
 * be remembered.
 *
 * The limits mirror the §5.22 global default rather than inventing a per-route policy;
 * writing them out means a later change to the global default cannot silently loosen
 * an unauthenticated endpoint.
 *
 * Every route returns a `PublicGarment*` DTO built from a query that can only see
 * published, test-render-approved garments (A-11, E-10). There is no admin type in
 * this file and no field on the ones there are that an admin-only column could reach.
 */
@ApiTags('Catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('garments')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ResponseMessage('Catalog retrieved successfully')
  @ApiOperation({
    summary: 'Published garments with an approved test render only (C-1, C-17)',
    description:
      'Filters: categoryId (includes sub-categories), color, size, embellishmentWeight, ' +
      'mode, priceMin, priceMax. Search spans title, category, colour and style tags. ' +
      'Sort: newest, mostTried, priceAsc, priceDesc. Prices are omitted entirely while ' +
      '`catalog.showPricesPublicly` is off (A-30).',
  })
  @ApiOkResponse({ type: [PublicGarmentSummaryDto] })
  @ApiStandardResponses({ auth: false })
  list(@Query() query: CatalogQueryDto): Promise<IPaginated<PublicGarmentSummaryDto>> {
    return this.catalog.list(query);
  }

  /**
   * Declared before `garments/:slugOrId` so `filters` and `new-arrivals` are matched
   * as literal segments rather than swallowed as a slug.
   */
  @Get('filters')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ResponseMessage('Filters retrieved successfully')
  @ApiOperation({
    summary: 'Available filter facets with counts, so the UI never offers an empty filter (§5.8)',
  })
  @ApiOkResponse({ type: CatalogFiltersResponseDto })
  @ApiStandardResponses({ auth: false })
  filters(): Promise<CatalogFiltersResponseDto> {
    return this.catalog.filters();
  }

  @Get('new-arrivals')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ResponseMessage('New arrivals retrieved successfully')
  @ApiOperation({
    summary: 'Recently published, optionally scoped to a category (C-8)',
  })
  @ApiOkResponse({ type: [PublicGarmentSummaryDto] })
  @ApiStandardResponses({ auth: false })
  newArrivals(@Query() query: NewArrivalsQueryDto): Promise<PublicGarmentSummaryDto[]> {
    return this.catalog.newArrivals(query);
  }

  @Get('garments/:slugOrId')
  @Public()
  @Roles(Role.PUBLIC)
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
  @ResponseMessage('Garment retrieved successfully')
  @ApiOperation({
    summary: 'Garment detail: gallery, price, fabric, sizes (C-18)',
    description:
      'A garment that is not published, or that has no approved test render, is ' +
      'GARMENT_NOT_FOUND — indistinguishable from one that never existed (S-9, E-10).',
  })
  @ApiOkResponse({ type: PublicGarmentDetailDto })
  @ApiStandardResponses({ auth: false, notFound: true })
  findOne(@Param() params: GarmentSlugParamDto): Promise<PublicGarmentDetailDto> {
    return this.catalog.findOne(params.slugOrId);
  }
}
