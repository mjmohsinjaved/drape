'use client';

import { useCallback } from 'react';

import { useTranslations } from 'next-intl';

import type { ApiError } from '@repo/api-client';

/**
 * Every `ErrorCode` the auth and account screens can receive, mapped to **local** copy.
 *
 * Nothing in this feature renders `ApiError.message`. The server's message is user-safe, but
 * it is English-only and it is not translated for the `ur` locale, so an Urdu reader would get
 * an English sentence in an otherwise Urdu screen. The English values in `auth.apiErrors` are
 * copied verbatim from ARCHITECTURE §2.4 so the two can never drift; the Urdu values are
 * written by the same hand in the same pass (§8.3 rule 9).
 *
 * `requestId` / `traceId` is never shown either. It is a support correlation id, not something
 * the user can act on, and D-7 asks for what to do next instead.
 */

/** The §2.4 codes these screens can actually produce, plus the four client-side ones (§6.4). */
const TRANSLATED_ERROR_CODES = [
  // Authentication and session
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
  'BOT_CHECK_FAILED',
  // Invites and accounts
  'EMAIL_ALREADY_EXISTS',
  'PHONE_ALREADY_EXISTS',
  'USER_NOT_FOUND',
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  'INVITE_ALREADY_CONSUMED',
  'DELETION_IN_PROGRESS',
  // Platform
  'RATE_LIMIT_EXCEEDED',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_CONFLICT',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  // Client-synthesised (§6.4)
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
  'REQUEST_ABORTED',
  'UNKNOWN_ERROR',
] as const;

const TRANSLATED_CODE_SET: ReadonlySet<string> = new Set<string>(TRANSLATED_ERROR_CODES);

/**
 * Codes that mean "your account may not do this", rather than "that did not work".
 *
 * They render the S-9 permission-denied state instead of an inline field error: plain
 * language, a way back, and nothing that reveals whether the resource exists (§8.2).
 */
const DENIED_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  'INSUFFICIENT_ROLE',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DEACTIVATED',
  'TWOFA_REQUIRED_FOR_ROLE',
  'DELETION_IN_PROGRESS',
]);

/** The form fields these screens submit. A field error outside this set falls back to generic. */
const KNOWN_FIELDS: ReadonlySet<string> = new Set<string>([
  'email',
  'password',
  'newPassword',
  'currentPassword',
  'name',
  'phone',
  'code',
  'recoveryCode',
  'token',
  'locale',
]);

export function isPermissionDeniedError(error: ApiError): boolean {
  return DENIED_ERROR_CODES.has(error.errorCode);
}

/**
 * True when trying the identical request again could plausibly work — a dropped connection, a
 * timeout, a 5xx. Drives whether the error state offers a retry (D-7).
 */
export function isRetryableError(error: ApiError): boolean {
  return error.isRetryable;
}

export interface ErrorCopy {
  /** The sentence to show. Always a local string, never the server's. */
  message: (error: ApiError) => string;
  /** Inline copy for one field, from the envelope's `errors[]` (§2.3). */
  fieldMessage: (error: ApiError, field: string) => string | undefined;
}

/**
 * Resolves an `ApiError` into translated copy.
 *
 * An unknown code — one the API added after this build — falls back to the generic sentence
 * rather than leaking an untranslated backend string onto the screen.
 */
export function useErrorCopy(): ErrorCopy {
  const t = useTranslations('auth.apiErrors');

  const message = useCallback(
    (error: ApiError): string => {
      if (TRANSLATED_CODE_SET.has(error.errorCode)) {
        return t(error.errorCode);
      }
      return t('fallback');
    },
    [t],
  );

  const fieldMessage = useCallback(
    (error: ApiError, field: string): string | undefined => {
      const entry = error.errors.find((candidate) => candidate.field === field);
      if (!entry) return undefined;
      // The envelope's per-field message is generated server-side and is not translated, so the
      // field name — which is stable — selects the copy instead of the message itself.
      return KNOWN_FIELDS.has(field) ? t(`fields.${field}`) : t('fields.generic');
    },
    [t],
  );

  return { message, fieldMessage };
}
