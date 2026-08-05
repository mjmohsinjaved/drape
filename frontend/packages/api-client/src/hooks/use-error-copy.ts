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
 *   copy.message(query.error);           // translated, in this screen's voice
 *   copy.isPermissionDenied(error);      // the D-5 permission-denied state?
 *   copy.isRetryableRead(error);         // a failed read — is "try again" honest?
 *   copy.isRetryableMutation(error);     // a failed write — is re-sending it honest?
 *
 * ═══ There is no plain `isRetryable` ═══
 *
 * There was, and it answered the **mutation** question — `isRetryableCode(code, statusCode)` —
 * for callers that were almost always holding a read. The two genuinely differ: a 409 on a write
 * will conflict again, while the same code arriving without a status is a read the caller can
 * repeat. One name for two answers is a defect waiting for its first caller, so the name is gone
 * and both questions have to be asked by their own name.
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
  /**
   * A failed **read**: is offering "try again" honest rather than a dead end (§10.3)?
   *
   * The status is deliberately not consulted. Re-issuing a GET that answered 409 or 404 is a
   * legitimate thing to offer — the resource may have moved on — and only the codes that name a
   * permanent dead end (`QUOTA_EXHAUSTED`, `CONSENT_REQUIRED`, …) rule it out.
   */
  isRetryableRead: (error: unknown) => boolean;
  /**
   * A failed **write**: can re-sending the identical request plausibly succeed?
   *
   * Status-aware, and therefore much narrower: a 4xx other than 408/429 will fail the same way
   * the second time, so offering the button would be a lie.
   */
  isRetryableMutation: (error: unknown) => boolean;
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
      isRetryableRead: (error) => isRetryableCode(resolveErrorCode(error)),
      isRetryableMutation: (error) =>
        isRetryableCode(resolveErrorCode(error), resolveStatusCode(error)),
    }),
    [fromCode],
  );
}
