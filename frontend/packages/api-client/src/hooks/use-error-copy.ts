'use client';

import { useCallback, useMemo } from 'react';

import { useTranslations } from 'next-intl';

import {
  isAuthenticationRequired,
  isPermissionDenied,
  isRetryableCode,
  resolveErrorCode,
  resolveStatusCode,
} from '../types/envelope';

/**
 * ═══ One failure → copy resolver, for every feature ═══
 *
 * There used to be three overlapping code→copy tables — `features/auth`, `features/tryon` and
 * `features/catalog` each maintained one, each with its own allow-list of codes it "knew about"
 * and its own name for the fallback string. They existed because the §2.3 envelope contract
 * claimed `ApiError.message` was display-ready, and it is not: it is English only, and Drape
 * ships `en` and `ur`. That sentence has been retired from the contract (see `types/envelope.ts`)
 * and this hook is what replaces the three tables.
 *
 * ═══ The map ═══
 *
 * There is exactly one code→key mapping in the app and it is the identity: an `ErrorCode` is
 * looked up as `<namespace>.<CODE>`. The **copy** is per feature — `tryon.errors`, `renders.errors`,
 * `admin.errors`, `auth.apiErrors` — because "that piece is no longer listed" and "that piece is
 * no longer in the catalog" are the same code said to two different readers. A namespace that has
 * no entry for a code falls back to its own `description`, which every namespace carries and
 * which is written to the D-7 rule: what happened, what to do next, no apology, no blame.
 *
 * An unknown code — one the API added after this build — therefore degrades to translated copy
 * rather than leaking an untranslated backend string onto the screen. Nothing here ever renders
 * `ApiError.message`, and nothing ever renders a `requestId` as if it were an explanation.
 *
 *   const copy = useErrorCopy('renders.errors');
 *   copy.message(query.error);        // translated, in this screen's voice
 *   copy.isPermissionDenied(error);   // the D-5 permission-denied state?
 *   copy.isRetryable(error);          // is offering "try again" honest?
 */

/** The key every namespace carries for a code it has no specific sentence for (D-7). */
export const FALLBACK_COPY_KEY = 'description';

export interface ErrorCopy {
  /** The `ErrorCode` behind anything a component can be handed. Total — never `undefined`. */
  code: (error: unknown) => string;
  /** Translated copy for one code, in this namespace's voice. */
  fromCode: (code: string | null | undefined) => string;
  /** Translated copy for anything a query or mutation can reject with. */
  message: (error: unknown) => string;
  /** True when the failure renders the D-5 permission-denied state (S-9). */
  isPermissionDenied: (error: unknown) => boolean;
  /** True when the session is gone and the next step is signing in. */
  isAuthenticationRequired: (error: unknown) => boolean;
  /** True when offering "try again" is honest rather than a dead end (§10.3). */
  isRetryable: (error: unknown) => boolean;
}

/**
 * @param namespace The i18n path holding this feature's `ErrorCode`-keyed copy, e.g.
 *   `'tryon.errors'`, `'admin.errors'`, `'auth.apiErrors'`.
 */
export function useErrorCopy(namespace: string): ErrorCopy {
  const t = useTranslations(namespace);

  const fromCode = useCallback(
    (code: string | null | undefined): string => {
      if (code === null || code === undefined || code === '') return t(FALLBACK_COPY_KEY);
      return t.has(code) ? t(code) : t(FALLBACK_COPY_KEY);
    },
    [t],
  );

  return useMemo<ErrorCopy>(
    () => ({
      code: resolveErrorCode,
      fromCode,
      message: (error) => fromCode(resolveErrorCode(error)),
      isPermissionDenied: (error) => isPermissionDenied(resolveErrorCode(error)),
      isAuthenticationRequired: (error) => isAuthenticationRequired(resolveErrorCode(error)),
      isRetryable: (error) => isRetryableCode(resolveErrorCode(error), resolveStatusCode(error)),
    }),
    [fromCode],
  );
}
