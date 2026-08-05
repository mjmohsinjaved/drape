/**
 * The `catalog` module's public surface.
 *
 * The export that matters to other modules is the **visibility predicate**. Anything
 * that needs to answer "may a consumer see this garment?" — a share link rendering a
 * card, an enquiry echoing back the piece it is about — should call
 * `isPubliclyVisible` rather than re-derive it from `publishState` and two
 * test-render columns. E-10 is only enforceable if there is one definition of visible.
 */
export { CatalogModule } from './catalog.module';
export { CatalogService } from './services/catalog.service';
export {
  CATALOG_CATEGORY_ALIAS,
  CATALOG_GARMENT_ALIAS,
  isPubliclyVisible,
  onlyPubliclyVisible,
  publicGarmentScope,
} from './queries/public-garment.scope';
export {
  CATALOG_SORTS,
  CatalogQueryDto,
  DEFAULT_NEW_ARRIVALS,
  GarmentSlugParamDto,
  MAX_NEW_ARRIVALS,
  NewArrivalsQueryDto,
  type CatalogSort,
} from './dto/catalog-query.dto';
export {
  CatalogFacetDto,
  CatalogFiltersResponseDto,
  CatalogPriceRangeDto,
} from './dto/catalog-filters-response.dto';
export {
  PublicGarmentDetailDto,
  PublicGarmentImageDto,
  PublicGarmentSummaryDto,
} from './dto/public-garment-response.dto';
export {
  toPublicGarmentDetail,
  toPublicGarmentSummary,
  toPublicImage,
  type PublicGarmentContext,
  type SignUrl,
} from './mappers/public-garment.mapper';
