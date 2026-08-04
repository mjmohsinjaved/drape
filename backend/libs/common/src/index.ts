/**
 * `@library/common` — the shared kernel.
 *
 * **Always import from this barrel** (`@library/common`), never from a deep path
 * such as `@library/common/guards/roles.guard` — ESLint's `no-restricted-imports`
 * enforces it (ARCHITECTURE.md §1.1).
 *
 * This library knows nothing about the application: it must never import from
 * `@api/*`, and it owns no entities.
 */

// ── config ────────────────────────────────────────────────────────────────────
export {
  boolEnv,
  enumEnv,
  EnvValidationError,
  intEnv,
  listEnv,
  optionalEnv,
  requireEnv,
  requireHexSecret,
  validateRequiredEnvVars,
  type EnvSource,
} from './config/env-validation';
export {
  buildSwaggerConfig,
  OPENAPI_EXPORT_PATH,
  SWAGGER_PATH,
  SWAGGER_TAGS,
  type SwaggerConfigOptions,
} from './config/swagger.config';

// ── constants ─────────────────────────────────────────────────────────────────
export {
  ALL_ERROR_CODES,
  ERROR_CODE_SPECS,
  ErrorCode,
  getErrorCodeSpec,
  httpStatusForErrorCode,
  isErrorCode,
  isMaskedErrorCode,
  MASKED_ERROR_CODES,
  maskErrorCode,
  type ErrorCodeSpec,
} from './constants/error-codes.constant';
export {
  FUNNEL_STEPS,
  METRIC_TAG_KEYS,
  METRICS,
  type FunnelStep,
  type MetricName,
  type MetricTagKey,
  type MetricTags,
} from './constants/metrics.constant';
export {
  hasRoleAtLeast,
  isAdmin,
  isConsumer,
  isRole,
  isUserRole,
  Locale,
  Role,
  ROLE_RANK,
  satisfiesRoles,
  USER_ROLES,
  UserStatus,
  type UserRole,
} from './constants/roles.constant';

// ── decorators ────────────────────────────────────────────────────────────────
export {
  ApiStandardResponses,
  type ApiStandardResponsesOptions,
} from './decorators/api-standard-responses.decorator';
export { CurrentUser } from './decorators/current-user.decorator';
export { IS_PUBLIC_KEY, Public } from './decorators/public.decorator';
export {
  DEFAULT_RESPONSE_MESSAGE,
  RESPONSE_MESSAGE_KEY,
  ResponseMessage,
} from './decorators/response-message.decorator';
export { ROLES_KEY, Roles } from './decorators/roles.decorator';
export { SKIP_CSRF_KEY, SkipCsrf } from './decorators/skip-csrf.decorator';

// ── dto ───────────────────────────────────────────────────────────────────────
export { IdParamDto } from './dto/id-param.dto';
export {
  DEFAULT_LIMIT,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  MAX_LIMIT,
  MIN_LIMIT,
  MIN_PAGE,
  PaginationQueryDto,
} from './dto/pagination-query.dto';

// ── exceptions ────────────────────────────────────────────────────────────────
export {
  AppException,
  isAppException,
  type AppExceptionOptions,
  type AppExceptionPayload,
  type FieldError,
} from './exceptions/app.exception';
export { AuthException } from './exceptions/auth.exception';
export { ConflictException } from './exceptions/conflict.exception';
export { ForbiddenException } from './exceptions/forbidden.exception';
export {
  ConsentException,
  GuardChainException,
  OwnershipException,
  QuotaException,
} from './exceptions/guard-chain.exception';
export { NotFoundException } from './exceptions/not-found.exception';
export { StorageException } from './exceptions/storage.exception';
export { UpstreamException } from './exceptions/upstream.exception';
export { ValidationException } from './exceptions/validation.exception';

// ── filters ───────────────────────────────────────────────────────────────────
export { GlobalExceptionFilter } from './filters/global-exception.filter';

// ── guards ────────────────────────────────────────────────────────────────────
export {
  CSRF_HEADER_NAME,
  CSRF_SAFE_METHODS,
  CsrfGuard,
  DEFAULT_CSRF_COOKIE_NAME,
  readCookie,
  type CookieBearingRequest,
} from './guards/csrf.guard';
export { RolesGuard } from './guards/roles.guard';
export { DEFAULT_SESSION_COOKIE_NAME, SessionAuthGuard } from './guards/session-auth.guard';
export { UserThrottlerGuard } from './guards/user-throttler.guard';

// ── interceptors ──────────────────────────────────────────────────────────────
export { ResponseTransformInterceptor } from './interceptors/response-transform.interceptor';

// ── interfaces ────────────────────────────────────────────────────────────────
export {
  isEnveloped,
  type ApiEnvelope,
  type ApiErrorResponse,
  type ApiResponse,
} from './interfaces/api-response.interface';
export type { ICurrentUser, RequestWithUser } from './interfaces/current-user.interface';
export {
  buildPaginationMeta,
  isPaginated,
  paginate,
  paginationSkip,
  type IPaginated,
  type PaginationInput,
  type PaginationMeta,
  type SortOrder,
} from './interfaces/pagination.interface';
export {
  SESSION_RESOLVER,
  type SessionResolutionContext,
  type SessionResolver,
} from './interfaces/session-resolver.interface';

// ── logger ────────────────────────────────────────────────────────────────────
export {
  createRequestContextStore,
  RequestContext,
  type RequestContextStore,
} from './logger/request-context';
export {
  LOG_LEVELS,
  rootLogger,
  StructuredLoggerService,
  type LogMeta,
  type LogWriter,
  type StructuredLogLevel,
  type StructuredLoggerOptions,
  type StructuredLogRecord,
} from './logger/structured-logger.service';

// ── metrics ───────────────────────────────────────────────────────────────────
export {
  METRICS_SINK,
  type HistogramSummary,
  type MetricKind,
  type MetricPoint,
  type MetricSeriesSnapshot,
  type MetricsSink,
  type MetricsSnapshot,
  type ReadableMetricsSink,
} from './metrics/metrics-sink.interface';
export { MetricsModule } from './metrics/metrics.module';
export { InProcessMetricsSink, MetricsService } from './metrics/metrics.service';

// ── middleware ────────────────────────────────────────────────────────────────
export { REQUEST_ID_HEADER, RequestIdMiddleware } from './middleware/request-id.middleware';
export { RequestLoggingMiddleware } from './middleware/request-logging.middleware';
export { SecurityHeadersMiddleware } from './middleware/security-headers.middleware';

// ── pipes ─────────────────────────────────────────────────────────────────────
export {
  constraintKeyToCode,
  CustomValidationPipe,
  flattenValidationErrors,
} from './pipes/custom-validation.pipe';

// ── utils ─────────────────────────────────────────────────────────────────────
export {
  base64UrlDecode,
  base64UrlEncode,
  DEFAULT_SIGNATURE_ENCODING,
  hmacSign,
  hmacVerify,
  randomHex,
  randomId,
  randomToken,
  timingSafeEqualBuffer,
  timingSafeEqualString,
  type SignatureEncoding,
} from './utils/crypto.util';
export {
  buildTryOnCacheKey,
  fingerprint,
  isSha256Hex,
  sha256EmailHex,
  sha256Hex,
  TRYON_CACHE_KEY_SEPARATOR,
  type TryOnCacheKeyInput,
} from './utils/hash.util';
export {
  addMoney,
  DEFAULT_CURRENCY,
  formatMoney,
  fromMinorUnits,
  isValidCurrency,
  isValidMoney,
  MAX_MONEY,
  MONEY_PRECISION,
  MONEY_SCALE,
  multiplyMoney,
  parseMoney,
  percentOfMoney,
  roundMoney,
  subtractMoney,
  sumMoney,
  toDecimalString,
  toMinorUnits,
} from './utils/money.util';
export {
  addPeriods,
  BILLING_PERIOD_LENGTH,
  BILLING_PERIOD_PATTERN,
  comparePeriods,
  currentPeriod,
  DEFAULT_BILLING_TIME_ZONE,
  formatPeriod,
  isInPeriod,
  isValidPeriod,
  lastNPeriods,
  nextPeriod,
  parsePeriod,
  periodEnd,
  periodFor,
  periodRange,
  periodResetsAt,
  periodStart,
  previousPeriod,
  type ParsedPeriod,
} from './utils/period.util';
export {
  isSensitiveKey,
  maskEmail,
  maskPhone,
  MAX_REDACT_ARRAY_LENGTH,
  MAX_REDACT_DEPTH,
  MAX_REDACT_STRING_LENGTH,
  redact,
  REDACTED,
  redactObject,
  redactString,
} from './utils/redact.util';
