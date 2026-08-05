/**
 * Turning a failure into copy — PRD D-7, ARCHITECTURE §2.4 and §6.7.
 *
 * **No screen in the consumer experience ever renders a raw backend message or a traceId.**
 * Every failure that reaches a component is reduced here to an `ErrorCode` string, and the
 * component looks that code up in its own i18n namespace under `errors.<CODE>`. A code with no
 * entry falls back to the namespace's `errors.description`, which is already written to the D-7
 * rule: what happened, what to do next, no apology, no blame.
 *
 * This lives in `features/tryon` because the try-on flow is the error-dense heart of the
 * consumer side, and there is no consumer-shared directory in this workstream. The six consumer
 * features import it from here rather than each keeping a copy — one resolver, one vocabulary.
 */

import { isApiError } from '@repo/api-client';

/**
 * Codes the client adds on its own behalf. §6.4 names the first two; `UNKNOWN_ERROR` is the
 * floor, so `resolveErrorCode` is total and a component never has to handle `undefined`.
 */
export const CLIENT_ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The one narrowing point. Accepts anything a component can be handed:
 *
 * - an `ApiError` from `@repo/api-client` (the browser path);
 * - a `ServerApiFailure` from `@/lib/server-api` (the Server Component path), which is a plain
 *   object carrying `errorCode` rather than an `Error` subclass;
 * - a bare string code, for the SSE `failed` event, which arrives off the wire as JSON;
 * - anything else at all, which is `UNKNOWN_ERROR`.
 */
export function resolveErrorCode(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (isApiError(error)) return error.errorCode;
  if (isRecord(error) && typeof error.errorCode === 'string') return error.errorCode;
  return CLIENT_ERROR_CODES.UNKNOWN_ERROR;
}

/**
 * Whether trying the same thing again is a sensible offer. A retry button on
 * `QUOTA_EXHAUSTED` would be a dead end wearing a button, which §10.3 rules out explicitly.
 */
const NOT_RETRYABLE = new Set([
  'QUOTA_EXHAUSTED',
  'BUDGET_EXHAUSTED',
  'CONSENT_REQUIRED',
  'CONSENT_STALE',
  'EMAIL_NOT_VERIFIED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'INSUFFICIENT_ROLE',
  'GARMENT_NOT_FOUND',
  'GARMENT_NOT_PUBLISHED',
  'TEST_RENDER_REQUIRED',
  'RESULT_NOT_FOUND',
  'JOB_NOT_FOUND',
  'PHOTO_NOT_FOUND',
  'PHOTO_LIMIT_REACHED',
  'MODERATION_REJECTED',
  'PHOTO_BLOCKED_BY_MODERATION',
  'IP_BLOCKED',
]);

export function isRetryableCode(code: string): boolean {
  return !NOT_RETRYABLE.has(code);
}

/** The guard-chain refusals that have a specific next screen rather than a retry (§8.1 step 3). */
export const CONSENT_CODES = ['CONSENT_REQUIRED', 'CONSENT_STALE'] as const;
export const PHOTO_CODES = [
  'PHOTO_NOT_FOUND',
  'PHOTO_NOT_OWNED',
  'PHOTO_BLOCKED_BY_MODERATION',
  'MODERATION_REJECTED',
  'UPSTREAM_UNSUPPORTED_FORMAT',
] as const;

export function needsConsent(code: string): boolean {
  return (CONSENT_CODES as readonly string[]).includes(code);
}

export function needsAnotherPhoto(code: string): boolean {
  return (PHOTO_CODES as readonly string[]).includes(code);
}

/**
 * The D-5 permission-denied state, rather than an error state.
 *
 * S-9: never a raw 403, never a message that reveals whether the resource exists. Every one of
 * these resolves to the same plain screen with a link back to the fitting room, whatever the
 * underlying cause was.
 */
const DENIED_CODES = new Set([
  'INSUFFICIENT_ROLE',
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'SESSION_INVALID',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
]);

export function isPermissionDenied(code: string): boolean {
  return DENIED_CODES.has(code);
}

/** `QUOTA_EXHAUSTED` and `BUDGET_EXHAUSTED` each get their own composed screen, never an error. */
export function isQuotaExhausted(code: string): boolean {
  return code === 'QUOTA_EXHAUSTED';
}

export function isBudgetExhausted(code: string): boolean {
  return code === 'BUDGET_EXHAUSTED';
}
