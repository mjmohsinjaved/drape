'use client';

import { useErrorCopy } from '@repo/api-client';

/**
 * Resolves any failure to translated copy inside one consumer i18n namespace.
 *
 * Each consumer namespace carries an `errors` object keyed by `ErrorCode`, plus an
 * `errors.description` fallback written to the D-7 rule. A code without an entry in this
 * namespace degrades to that fallback rather than to a raw backend string — nothing on a
 * consumer screen is ever the server's own words, and nothing is ever a traceId (§6.7).
 *
 * The resolution itself lives in `@repo/api-client`; this is the consumer-side spelling of it,
 * taking the feature namespace rather than the full path to its `errors` object.
 */
export function useErrorMessage(namespace: string): (error: unknown) => string {
  return useErrorCopy(`${namespace}.errors`).message;
}
