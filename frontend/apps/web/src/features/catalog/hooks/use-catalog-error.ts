'use client';

import { useCallback } from 'react';

import { useTranslations } from 'next-intl';

import { isApiError } from '@repo/api-client';

/**
 * `ErrorCode` → console copy.
 *
 * The API's `message` is already user-safe, but it is written for a generic client and it is
 * English-only. §6.7 requires every string on screen to come through next-intl, so the console
 * keys off the **code** and renders its own translated copy; the server message is never
 * displayed. A code this table does not know falls back to the generic wording rather than to a
 * raw backend string.
 *
 * Every message states what happened and what to do next (D-7): it does not apologise, does not
 * blame the admin, and is never vague.
 */
const CATALOG_ERROR_KEYS: Readonly<Record<string, string>> = {
  /* --- categories, A-5 / A-7 --- */
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  CATEGORY_HAS_PUBLISHED_GARMENTS: 'CATEGORY_HAS_PUBLISHED_GARMENTS',
  CATEGORY_DEPTH_EXCEEDED: 'CATEGORY_DEPTH_EXCEEDED',
  CATEGORY_ARCHIVED: 'CATEGORY_ARCHIVED',

  /* --- garments, A-8 / A-13 --- */
  GARMENT_NOT_FOUND: 'GARMENT_NOT_FOUND',
  GARMENT_SKU_EXISTS: 'GARMENT_SKU_EXISTS',
  INVALID_PUBLISH_TRANSITION: 'INVALID_PUBLISH_TRANSITION',

  /* --- the publish gates, A-9 / A-10 / A-11 --- */
  TRYON_SOURCE_REQUIRED: 'TRYON_SOURCE_REQUIRED',
  TRYON_SOURCE_ALREADY_SET: 'TRYON_SOURCE_ALREADY_SET',
  TEST_RENDER_REQUIRED: 'TEST_RENDER_REQUIRED',
  GARMENT_QUALITY_BELOW_THRESHOLD: 'GARMENT_QUALITY_BELOW_THRESHOLD',
  QUALITY_OVERRIDE_REQUIRED: 'QUALITY_OVERRIDE_REQUIRED',

  /* --- images, A-9 / A-10 --- */
  IMAGE_TOO_SMALL: 'IMAGE_TOO_SMALL',
  IMAGE_FORMAT_UNSUPPORTED: 'IMAGE_FORMAT_UNSUPPORTED',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  IMAGE_CORRUPT: 'IMAGE_CORRUPT',
  UPLOAD_TICKET_INVALID: 'UPLOAD_TICKET_INVALID',
  UPLOAD_TICKET_EXPIRED: 'UPLOAD_TICKET_EXPIRED',

  /* --- bulk and budget, A-12 / A-29 --- */
  BULK_OPERATION_PARTIAL_FAILURE: 'BULK_OPERATION_PARTIAL_FAILURE',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  /* --- upstream, §8.3 --- */
  UPSTREAM_NO_GARMENT_DETECTED: 'UPSTREAM_NO_GARMENT_DETECTED',
  UPSTREAM_UNSUPPORTED_FORMAT: 'UPSTREAM_UNSUPPORTED_FORMAT',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  UPSTREAM_RATE_LIMITED: 'UPSTREAM_RATE_LIMITED',
  MODERATION_REJECTED: 'MODERATION_REJECTED',

  /* --- transport, synthesised client-side (§6.4) --- */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
};

export interface CatalogErrorCopy {
  /** Translated copy for one error code. Never the server's own string. */
  fromCode: (code: string | null | undefined) => string;
  /** Translated copy for anything a mutation or query can reject with. */
  fromError: (error: unknown) => string;
  /** True when trying the same request again could plausibly work (§6.4). */
  isRetryable: (error: unknown) => boolean;
}

/**
 * The D-5 permission-denied state, distinguished from an ordinary failure.
 *
 * The API is the sole authority (B-10) and the shell has already re-verified the role
 * server-side, so this only fires when a session ends or a role changes under a screen that is
 * already open. It gets the S-9 treatment — plain language, a way out, no status code.
 */
export function isPermissionDenied(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.isOneOf('INSUFFICIENT_ROLE', 'AUTH_REQUIRED', 'SESSION_EXPIRED', 'SESSION_INVALID')
  );
}

export function useCatalogErrorCopy(): CatalogErrorCopy {
  const t = useTranslations('admin.errors');

  const fromCode = useCallback(
    (code: string | null | undefined): string => {
      const key = code ? CATALOG_ERROR_KEYS[code] : undefined;
      return key ? t(key) : t('GENERIC');
    },
    [t],
  );

  const fromError = useCallback(
    (error: unknown): string => (isApiError(error) ? fromCode(error.errorCode) : t('GENERIC')),
    [fromCode, t],
  );

  const isRetryable = useCallback(
    (error: unknown): boolean => isApiError(error) && error.isRetryable,
    [],
  );

  return { fromCode, fromError, isRetryable };
}
