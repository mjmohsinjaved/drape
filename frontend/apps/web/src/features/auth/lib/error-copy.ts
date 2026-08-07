'use client';

import { useCallback, useMemo } from 'react';

import { useTranslations } from 'next-intl';

import { useErrorCopy as useSharedErrorCopy ,type  ApiError } from '@repo/api-client';


/**
 * Failure copy for the auth and account screens.
 *
 * ═══ What changed ═══
 *
 * This file used to carry its own 45-entry allow-list of "codes we have copy for", its own
 * permission-denied list and its own retryability wrapper — all three duplicated in
 * `features/tryon` and `features/catalog`, and the permission-denied lists already disagreed.
 * The classification now lives once on `ApiError` in `@repo/api-client`, and the code→copy
 * lookup is `useErrorCopy('auth.apiErrors')`. The allow-list is gone because `t.has(code)`
 * answers the same question from the catalogue itself, and so cannot drift from it.
 *
 * ═══ What is genuinely local ═══
 *
 * Field copy. The envelope's per-field `errors[]` messages are generated server-side and are not
 * translated, so the **field name** — which is stable — selects the copy, not the message. That
 * is a property of these forms, not of the error contract, so it stays here.
 *
 * The English values in `auth.apiErrors` are copied verbatim from ARCHITECTURE §2.4 so the two
 * cannot drift; the Urdu values are written by the same hand in the same pass (§8.3 rule 9).
 * `requestId` / `traceId` is never shown: it is a support correlation id, not something the
 * reader can act on, and D-7 asks for what to do next instead.
 */

/** The form fields these screens submit. A field error outside this set falls back to generic. */
const KNOWN_FIELDS: ReadonlySet<string> = new Set<string>([
  'email',
  'password',
  'newPassword',
  'currentPassword',
  'name',
  'phone',
  'code',
  'token',
  'locale',
]);

export interface ErrorCopy {
  /** The sentence to show. Always a local string, never the server's. */
  message: (error: ApiError) => string;
  /** Inline copy for one field, from the envelope's `errors[]` (§2.3). */
  fieldMessage: (error: ApiError, field: string) => string | undefined;
}

/**
 * Resolves an `ApiError` into translated copy.
 *
 * An unknown code — one the API added after this build — falls back to the namespace's
 * `description` rather than leaking an untranslated backend string onto the screen.
 */
export function useErrorCopy(): ErrorCopy {
  const shared = useSharedErrorCopy('auth.apiErrors');
  const t = useTranslations('auth.apiErrors');

  const fieldMessage = useCallback(
    (error: ApiError, field: string): string | undefined => {
      const entry = error.errors.find((candidate) => candidate.field === field);
      if (!entry) return undefined;
      return KNOWN_FIELDS.has(field) ? t(`fields.${field}`) : t('fields.generic');
    },
    [t],
  );

  const message = shared.message;

  return useMemo<ErrorCopy>(() => ({ message, fieldMessage }), [message, fieldMessage]);
}
