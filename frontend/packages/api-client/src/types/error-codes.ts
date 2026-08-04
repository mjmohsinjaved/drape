/**
 * The `ErrorCode` enum of ARCHITECTURE.md §2.4, mirrored on the frontend as a closed union.
 *
 * The backend declares this as a TypeScript `enum` in
 * `libs/common/src/constants/error-codes.constant.ts`. Here it is a `const` tuple so the values
 * are iterable at runtime (filter dropdowns, exhaustive tests) and the union type is derived from
 * the single list — there is no second place to keep in sync.
 *
 * Adding a code means adding a row to §2.4 in the same pull request. Order below follows §2.4.
 */

/** §2.4 — Authentication and session. */
const AUTH_ERROR_CODES = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'EMAIL_NOT_VERIFIED',
  'PHONE_NOT_VERIFIED',
  'TWOFA_REQUIRED',
  'TWOFA_INVALID',
  'TWOFA_ALREADY_ENABLED',
  'TWOFA_REQUIRED_FOR_ROLE',
  'PASSWORD_POLICY_VIOLATION',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'TOKEN_ALREADY_USED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_MAX_ATTEMPTS',
  'CSRF_TOKEN_MISSING',
  'CSRF_TOKEN_INVALID',
  'INSUFFICIENT_ROLE',
  'SELF_ROLE_CHANGE_FORBIDDEN',
  'LAST_ADMIN_PROTECTED',
  'BOT_CHECK_FAILED',
] as const;

/** §2.4 — Invites and accounts. */
const ACCOUNT_ERROR_CODES = [
  'EMAIL_ALREADY_EXISTS',
  'PHONE_ALREADY_EXISTS',
  'USER_NOT_FOUND',
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  'INVITE_ALREADY_CONSUMED',
  'DELETION_IN_PROGRESS',
] as const;

/** §2.4 — The try-on guard chain (PRD §8.1 step 3), in evaluation order. */
const GUARD_CHAIN_ERROR_CODES = [
  'CONSENT_REQUIRED',
  'CONSENT_STALE',
  'QUOTA_EXHAUSTED',
  'RATE_LIMIT_EXCEEDED',
  'BUDGET_EXHAUSTED',
  'GARMENT_NOT_PUBLISHED',
  'TEST_RENDER_REQUIRED',
  'IDEMPOTENCY_IN_FLIGHT',
] as const;

/**
 * §2.4 — Ownership codes. The `*_NOT_OWNED` half is **never received by a client**: the
 * `GlobalExceptionFilter` masks each one to its `*_NOT_FOUND` counterpart (see
 * {@link MASKED_ERROR_CODES}). They are declared here only so the union is complete and so tests
 * can assert the masking.
 */
const OWNERSHIP_ERROR_CODES = [
  'PHOTO_NOT_OWNED',
  'PHOTO_NOT_FOUND',
  'RESULT_NOT_OWNED',
  'RESULT_NOT_FOUND',
  'JOB_NOT_OWNED',
  'JOB_NOT_FOUND',
  'ENQUIRY_NOT_OWNED',
  'ENQUIRY_NOT_FOUND',
  'SHORTLIST_ITEM_NOT_OWNED',
  'SHORTLIST_ITEM_NOT_FOUND',
  'SHARE_LINK_NOT_OWNED',
  'SHARE_LINK_NOT_FOUND',
] as const;

/** §2.4 — Upstream (TryOnCloud), the PRD §8.3 failure taxonomy. */
const UPSTREAM_ERROR_CODES = [
  'UPSTREAM_NO_GARMENT_DETECTED',
  'UPSTREAM_UNSUPPORTED_FORMAT',
  'MODERATION_REJECTED',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_RATE_LIMITED',
  'UPSTREAM_INVALID_RESPONSE',
  'TRYON_PROVIDER_MISCONFIGURED',
] as const;

/** §2.4 — Catalog, garments, images. */
const CATALOG_ERROR_CODES = [
  'CATEGORY_NOT_FOUND',
  'CATEGORY_HAS_PUBLISHED_GARMENTS',
  'CATEGORY_DEPTH_EXCEEDED',
  'CATEGORY_ARCHIVED',
  'GARMENT_NOT_FOUND',
  'GARMENT_SKU_EXISTS',
  'INVALID_PUBLISH_TRANSITION',
  'TRYON_SOURCE_REQUIRED',
  'TRYON_SOURCE_ALREADY_SET',
  'GARMENT_QUALITY_BELOW_THRESHOLD',
  'QUALITY_OVERRIDE_REQUIRED',
  'IMAGE_TOO_SMALL',
  'IMAGE_FORMAT_UNSUPPORTED',
  'IMAGE_TOO_LARGE',
  'IMAGE_CORRUPT',
  'BULK_OPERATION_PARTIAL_FAILURE',
] as const;

/** §2.4 — Photos, consent, results, engagement. */
const ENGAGEMENT_ERROR_CODES = [
  'CONSENT_POLICY_NOT_FOUND',
  'PHOTO_LIMIT_REACHED',
  'PHOTO_VALIDATION_FAILED',
  'PHOTO_BLOCKED_BY_MODERATION',
  'SHORTLIST_EMPTY',
  'SHARE_LINK_REVOKED',
  'SHARE_LINK_EXPIRED',
  'SHARING_DISABLED',
  'VOTE_ALREADY_CAST',
  'ENQUIRIES_DISABLED',
  'ENQUIRY_ALREADY_OPEN',
  'ENQUIRY_LOST_REASON_REQUIRED',
  'INVALID_ENQUIRY_TRANSITION',
] as const;

/** §2.4 — Quota, moderation, settings, files, platform. */
const PLATFORM_ERROR_CODES = [
  'QUOTA_ADJUSTMENT_INVALID',
  'MODERATION_ITEM_NOT_FOUND',
  'MODERATION_ALREADY_REVIEWED',
  'IP_BLOCKED',
  'SETTINGS_KEY_UNKNOWN',
  'SETTINGS_VALUE_INVALID',
  'FILE_TOKEN_INVALID',
  'FILE_TOKEN_EXPIRED',
  'FILE_TOKEN_SUBJECT_MISMATCH',
  'FILE_NOT_FOUND',
  'UPLOAD_TICKET_INVALID',
  'UPLOAD_TICKET_EXPIRED',
  'STORAGE_WRITE_FAILED',
  'STORAGE_PATH_REJECTED',
  'EXPORT_NOT_READY',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_CONFLICT',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

/** The complete, closed set of server-issued error codes (§2.4). */
export const ERROR_CODES = [
  ...AUTH_ERROR_CODES,
  ...ACCOUNT_ERROR_CODES,
  ...GUARD_CHAIN_ERROR_CODES,
  ...OWNERSHIP_ERROR_CODES,
  ...UPSTREAM_ERROR_CODES,
  ...CATALOG_ERROR_CODES,
  ...ENGAGEMENT_ERROR_CODES,
  ...PLATFORM_ERROR_CODES,
] as const;

/** A code the API can put in the `errorCode` field of the §2.3 error envelope. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Codes the **client** synthesises for failures that never reach the API, and therefore have no
 * §2.3 envelope to unwrap (§6.4). The copy for these is translated locally, not by the server.
 */
export const CLIENT_ERROR_CODES = [
  /** No response at all — offline, DNS failure, CORS rejection, connection reset. */
  'NETWORK_ERROR',
  /** The request exceeded the axios timeout (`ECONNABORTED` / `ETIMEDOUT`). */
  'REQUEST_TIMEOUT',
  /** An `AbortController` cancelled the request — usually a React unmount, not a real failure. */
  'REQUEST_ABORTED',
  /** A response arrived but carried no recognisable envelope. */
  'UNKNOWN_ERROR',
] as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/** Every code an `ApiError.errorCode` may legitimately hold. */
export type ApiErrorCode = ErrorCode | ClientErrorCode;

const SERVER_ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(ERROR_CODES);
const CLIENT_ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(CLIENT_ERROR_CODES);

/** Narrows an arbitrary wire string to a §2.4 code. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && SERVER_ERROR_CODE_SET.has(value);
}

/** Narrows an arbitrary wire string to a client-synthesised code. */
export function isClientErrorCode(value: unknown): value is ClientErrorCode {
  return typeof value === 'string' && CLIENT_ERROR_CODE_SET.has(value);
}

/** True for any code this client knows about, server-issued or client-synthesised. */
export function isKnownErrorCode(value: unknown): value is ApiErrorCode {
  return isErrorCode(value) || isClientErrorCode(value);
}

/**
 * §2.4 masking rule, mirrored so tests and the UI can reason about it. The server never sends the
 * left-hand side; this map exists to document that and to keep the two halves paired.
 */
export const MASKED_ERROR_CODES: Readonly<Partial<Record<ErrorCode, ErrorCode>>> = {
  PHOTO_NOT_OWNED: 'PHOTO_NOT_FOUND',
  RESULT_NOT_OWNED: 'RESULT_NOT_FOUND',
  JOB_NOT_OWNED: 'JOB_NOT_FOUND',
  ENQUIRY_NOT_OWNED: 'ENQUIRY_NOT_FOUND',
  SHORTLIST_ITEM_NOT_OWNED: 'SHORTLIST_ITEM_NOT_FOUND',
  SHARE_LINK_NOT_OWNED: 'SHARE_LINK_NOT_FOUND',
} as const;

/**
 * The codes that mean "this session is over". The response interceptor clears the auth store and
 * redirects to `/login` on any of these (§6.4).
 */
export const SESSION_ENDED_ERROR_CODES = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
] as const satisfies readonly ErrorCode[];

/**
 * The guard-chain codes a consumer can hit on `POST /tryon`. The try-on UI renders a dedicated
 * state for each rather than a generic error toast (D-5).
 */
export const TRYON_GUARD_ERROR_CODES = [
  ...GUARD_CHAIN_ERROR_CODES,
  'PHOTO_NOT_FOUND',
] as const satisfies readonly ErrorCode[];

export type TryOnGuardErrorCode = (typeof TRYON_GUARD_ERROR_CODES)[number];
