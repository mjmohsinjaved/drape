'use client';

import {
  isAuthenticationRequired as isAuthenticationRequiredCode,
  isPermissionDenied as isPermissionDeniedCode,
  resolveErrorCode,
  useErrorCopy,
  type ErrorCopy,
} from '@repo/api-client';

/**
 * `ErrorCode` → console copy.
 *
 * This was the third of three code→copy tables in the app, and the third answer to "which codes
 * mean permission denied". Both now come from `@repo/api-client`: the copy through
 * `useErrorCopy('admin.errors')`, the classification from `ApiError`. The 30-entry key map that
 * lived here is gone — it mapped every code to itself, and `t.has(code)` reads the same fact
 * straight off the catalogue, so a code added to `admin.json` is picked up without a second edit
 * here.
 *
 * The API's `message` is still never displayed: it is English-only, and §6.7 requires every
 * string on screen to come through next-intl. Every message states what happened and what to do
 * next (D-7): it does not apologise, does not blame the admin, and is never vague.
 */

export type CatalogErrorCopy = ErrorCopy;

/**
 * The D-5 permission-denied state, distinguished from an ordinary failure.
 *
 * The API is the sole authority (B-10) and the shell has already re-verified the role
 * server-side, so this only fires when a role changes under a screen that is already open. It
 * gets the S-9 treatment — plain language, a way out, no status code.
 *
 * A session that *ended* under an open screen is {@link isSignedOut}, not this: the console used
 * to show "you don't have access" for a timed-out session, which is neither true nor actionable.
 */
export function isPermissionDenied(error: unknown): boolean {
  return isPermissionDeniedCode(resolveErrorCode(error));
}

/** The session ended while this screen was open. The next step is signing in, not a retry. */
export function isSignedOut(error: unknown): boolean {
  return isAuthenticationRequiredCode(resolveErrorCode(error));
}

export function useCatalogErrorCopy(): CatalogErrorCopy {
  return useErrorCopy('admin.errors');
}
