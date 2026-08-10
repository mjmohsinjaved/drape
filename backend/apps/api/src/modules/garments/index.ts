/**
 * The `garments` module's public surface.
 *
 * `catalog` takes the entities and the visibility helpers; `tryon` (W3) takes
 * `GarmentsService` to read a garment before a generation and to record a test
 * render's outcome against it.
 *
 * The publish gate is exported deliberately. It is the A-11 / E-10 rule, and any
 * module that needs to know whether a garment is fit to be seen should ask this
 * function rather than re-deriving the answer from two columns.
 */
export { GarmentsModule } from './garments.module';
export { GarmentsService, STAR_RATE_SQL } from './services/garments.service';
export { CatalogHealthService } from './services/catalog-health.service';
export {
  CATALOG_HEALTH_COHORTS,
  CATALOG_HEALTH_COHORT_IDS,
  DEFAULT_CATALOG_HEALTH_SAMPLE,
  ELEVATED_FAILURE_MIN_ATTEMPTS,
  ELEVATED_FAILURE_RATE_PERCENT,
  MAX_CATALOG_HEALTH_SAMPLE,
  STALE_TRY_ON_DAYS,
  catalogHealthCohort,
  catalogHealthScopeSql,
  catalogHealthSqlParams,
  isInCatalogHealthScope,
  staleTryOnCutoff,
  type CatalogHealthCohort,
  type CatalogHealthCohortId,
  type CatalogHealthContext,
  type CatalogHealthSqlParams,
} from './services/catalog-health.cohorts';
export {
  CatalogHealthCohortDto,
  CatalogHealthQueryDto,
  CatalogHealthResponseDto,
  CatalogHealthThresholdsDto,
} from './dto/catalog-health.dto';
export {
  GarmentImageBatchDto,
  GarmentImageBatchEntryDto,
  GarmentImageBatchResponseDto,
  MAX_BATCH_GARMENT_IMAGES,
} from './dto/garment-image-batch.dto';
export {
  ALLOWED_PUBLISH_TRANSITIONS,
  evaluatePublishAdvisories,
  hasApprovedTestRender,
  hasQualityOverride,
  isAllowedPublishTransition,
  type PublishGateInput,
} from './services/garment-publish.gate';
export { CreateGarmentDto } from './dto/create-garment.dto';
export { DeleteGarmentDto } from './dto/delete-garment.dto';
export { GarmentBulkAction, GarmentBulkDto, MAX_BULK_GARMENTS } from './dto/garment-bulk.dto';
export { GarmentIdParamDto } from './dto/garment-id-param.dto';
export { GarmentQualityOverrideDto } from './dto/garment-quality-override.dto';
export { GARMENT_SORT_KEYS, GarmentQueryDto, type GarmentSortKey } from './dto/garment-query.dto';
export {
  GarmentBulkItemResultDto,
  GarmentBulkResultDto,
  GarmentQualityCheckDto,
  GarmentResponseDto,
} from './dto/garment-response.dto';
export { UpdateGarmentDto } from './dto/update-garment.dto';
export { starRateOf, toGarmentResponse } from './mappers/garment.mapper';
