/**
 * The `tryon` module's public surface.
 *
 * Two things other modules legitimately need:
 *
 *  - `TestRenderService` — `garments` reads the A-11 state for the publish screen.
 *  - the two **ports** below, which `TryOnModule` binds to adapters over
 *    `PersonPhotosService` and the `quota` services.
 *
 * C-16 cache retirement is **not** on this surface. `person-photos` does not call into
 * this module for it — it emits `PERSON_PHOTO_EVENTS.REMOVED` and
 * `PersonPhotoRemovedListener` here retires the rows (§3.7, §4.19). Renders already
 * produced stay in history (C-28).
 *
 * Nothing else is exported. In particular `TryOnRunnerService` is not: it is the only
 * code that may charge for a generation, and the fewer places that can reach it, the
 * easier "quota and budget decrement only on success" is to verify.
 */
export { TryOnModule } from './tryon.module';

export { TryOnConfig } from './config/tryon.config';

export {
  TryOnCacheService,
  type CacheWriteInput,
  type CopiedRender,
} from './services/tryon-cache.service';
export { TestRenderService } from './services/test-render.service';
export {
  TRYON_FAILURE_CODES,
  TRYON_FAILURE_POLICY,
  consumerMessageFor,
  failureBehaviourFor,
  type FailureBehaviour,
} from './services/tryon-failure.policy';

// ── ports (the seams to `person-photos` and `quota`) ─────────────────────────────
export {
  PERSON_PHOTO_PORT,
  type PersonPhotoPort,
  type PersonPhotoRef,
} from './ports/person-photo.port';
export {
  QUOTA_PORT,
  type BudgetView,
  type ChargeGenerationInput,
  type QuotaPort,
  type QuotaView,
} from './ports/quota.port';

// ── the upstream seam ────────────────────────────────────────────────────────────
export {
  TRYON_PROVIDER,
  TRYON_PROVIDER_ERROR_CODES,
  TryOnProviderError,
  isTryOnProviderError,
  type TryOnGenerationRequest,
  type TryOnGenerationResult,
  type TryOnProvider,
  type TryOnProviderErrorCode,
} from './providers/tryon-provider.interface';
export { createTryOnProvider, tryOnProviderFactory } from './providers/tryon-provider.factory';
export { MockTryOnProvider } from './providers/mock-tryon.provider';
export { HttpTryOnProvider } from './providers/http-tryon.provider';

// ── the guard chain (E-5) ────────────────────────────────────────────────────────
export {
  TRYON_GUARD_ORDER,
  checkAccountStatus,
  checkBudget,
  checkConsent,
  checkEmailVerified,
  checkGarmentReady,
  checkIdempotency,
  checkPhotoOwnership,
  checkQuota,
  checkRateLimits,
  checkSession,
  type ExistingJobFacts,
  type GuardRejection,
  type RateWindow,
} from './guards/tryon-guard.predicates';

// ── enums and DTOs ───────────────────────────────────────────────────────────────
export { JobOrigin } from './enums/job-origin.enum';
export { JobStatus } from './enums/job-status.enum';
export { CreateTryOnDto, MAX_IDEMPOTENCY_KEY_LENGTH } from './dto/create-tryon.dto';
export { TryOnJobResponseDto } from './dto/tryon-job-response.dto';
export {
  BulkTestRenderDto,
  MAX_BULK_TEST_RENDERS,
  RejectTestRenderDto,
  RunTestRenderDto,
  TestRenderEstimateDto,
} from './dto/test-render.dto';
export {
  ReferenceModelResponseDto,
  TestRenderBatchItemDto,
  TestRenderBatchResponseDto,
  TestRenderEstimateResponseDto,
  TestRenderResponseDto,
} from './dto/test-render-response.dto';
