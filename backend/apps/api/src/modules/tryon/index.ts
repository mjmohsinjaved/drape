export { TryOnModule } from './tryon.module';

export { TryOnConfig } from './config/tryon.config';

export {
  TryOnCacheService,
  type CacheWriteInput,
  type CopiedRender,
} from './services/tryon-cache.service';
export { TestRenderService } from './services/test-render.service';
export {
  TestRenderBatchEventsService,
  type BatchCompletedEventData,
  type BatchEventName,
  type BatchProgressEventData,
} from './services/test-render-batch-events.service';
export {
  TRYON_FAILURE_CODES,
  TRYON_FAILURE_POLICY,
  consumerMessageFor,
  failureBehaviourFor,
  type FailureBehaviour,
} from './services/tryon-failure.policy';

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
export {
  buildTryOnProviders,
  createTryOnProvider,
  selectTryOnProvider,
  type QualityReader,
} from './providers/tryon-provider.factory';
export {
  TRYON_PROVIDER_RESOLVER,
  TryOnProviderResolver,
  type ResolvedTryOnProvider,
} from './providers/tryon-provider.resolver';
export { MockTryOnProvider } from './providers/mock-tryon.provider';
export { HttpTryOnProvider } from './providers/http-tryon.provider';
export { GeminiTryOnProvider } from './providers/gemini-tryon.provider';
export { OpenAiTryOnProvider } from './providers/openai-tryon.provider';

export { TryOnProviderAdminService } from './services/tryon-provider-admin.service';
export {
  SelectTryOnProviderDto,
  TryOnProviderOptionDto,
  TryOnProviderStateDto,
} from './dto/tryon-provider.dto';

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
