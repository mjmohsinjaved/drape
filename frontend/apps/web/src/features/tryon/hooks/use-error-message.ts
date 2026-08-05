'use client';

import { useCallback } from 'react';

import { useTranslations } from 'next-intl';

import { resolveErrorCode } from '@/features/tryon/lib/error-copy';

/**
 * Resolves any failure to translated copy inside one i18n namespace.
 *
 * Each consumer namespace carries an `errors` object keyed by `ErrorCode`, plus an
 * `errors.description` fallback written to the D-7 rule. A code without an entry in this
 * namespace degrades to that fallback rather than to a raw backend string — nothing on a
 * consumer screen is ever the server's own words, and nothing is ever a traceId (§6.7).
 */
export function useErrorMessage(namespace: string): (error: unknown) => string {
  const t = useTranslations(namespace);

  return useCallback(
    (error: unknown): string => {
      const code = resolveErrorCode(error);
      const key = `errors.${code}`;
      return t.has(key) ? t(key) : t('errors.description');
    },
    [t],
  );
}
