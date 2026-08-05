/**
 * Consumer-side failure vocabulary — PRD D-7, ARCHITECTURE §2.4 and §6.7.
 *
 * **No screen in the consumer experience ever renders a raw backend message or a traceId.**
 * Every failure that reaches a component is reduced to an `ErrorCode` and looked up in the
 * screen's own i18n namespace under `errors.<CODE>` — see `useErrorCopy` in `@repo/api-client`.
 *
 * ═══ What is left here ═══
 *
 * Only the questions that are genuinely about the *try-on flow*: which refusals have a specific
 * next screen rather than a message. The three questions every feature asks — is this the
 * permission-denied state, is the session gone, is a retry honest — are answered once in
 * `@repo/api-client`, because this module and `features/auth/lib/error-copy.ts` used to answer
 * them differently and the same failure produced a different screen depending on which one
 * caught it. They are re-exported below so the consumer screens keep a single import.
 */

import {
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
  resolveErrorCode,
} from '@repo/api-client';

export { isAuthenticationRequired, isPermissionDenied, isRetryableCode, resolveErrorCode };

/**
 * Codes the client adds on its own behalf. §6.4 names the first two; `UNKNOWN_ERROR` is the
 * floor, so `resolveErrorCode` is total and a component never has to handle `undefined`.
 */
export const CLIENT_ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

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

/** `QUOTA_EXHAUSTED` and `BUDGET_EXHAUSTED` each get their own composed screen, never an error. */
export function isQuotaExhausted(code: string): boolean {
  return code === 'QUOTA_EXHAUSTED';
}

export function isBudgetExhausted(code: string): boolean {
  return code === 'BUDGET_EXHAUSTED';
}
