'use client';

import * as React from 'react';

import { useTranslations } from 'next-intl';

import { ErrorState } from '@repo/ui';

import { useRouter } from '@/i18n/navigation';

export interface ScreenErrorProps {
  /** Already resolved through the screen's own `errors.*` namespace (D-7). */
  title: string;
  description: string;
  /**
   * `ServerApiFailure.requestId` — the `X-Request-Id` the API stamped on the response.
   *
   * PRD E-12 keeps personal data out of the logs, so this id is the *only* thing that ties what
   * she saw to the line the studio can look up. It is shown as an opaque reference to quote, not
   * as a diagnostic: no status code, no error code and no stack trace reaches the screen (§8.1).
   */
  requestId?: string | undefined;
  /**
   * Whether offering "try again" is honest.
   *
   * True only when the failure came from a **read**. A retry here is `router.refresh()`, which
   * re-runs the Server Component — safe for a GET, and never used for a mutation that may have
   * partially applied. Screens pass `isRetryableCode(...)` so a dead end like `QUOTA_EXHAUSTED`
   * never gets a button that cannot help (§10.3).
   */
  retryable?: boolean;
  /** The way onwards when a retry is not it — usually a link back to the collection (D-6). */
  secondaryAction?: React.ReactNode;
  /** `inline` when the state replaces one region of a screen rather than the screen. */
  size?: 'page' | 'inline';
  /** Match the surrounding outline: `h2` under an existing `h1`. */
  headingLevel?: 'h2' | 'h3' | 'h4';
}

/**
 * The error state a **Server Component** renders when a read fails — D-5, D-7.
 *
 * It exists because `ErrorState` is a client component and `onRetry` is a function: a Server
 * Component cannot hand it one. This island supplies the retry (`router.refresh()`, wrapped in a
 * transition so the button can show it is working) and the reference line, and takes everything
 * else as serialisable props.
 *
 * Route boundaries use `RouteError` instead — they already have Next's `reset()`.
 */
export function ScreenError({
  title,
  description,
  requestId,
  retryable = true,
  secondaryAction,
  size,
  headingLevel,
}: ScreenErrorProps) {
  const t = useTranslations('errors');
  const router = useRouter();
  const [retrying, startTransition] = React.useTransition();

  const retry = React.useCallback((): void => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  return (
    <ErrorState
      title={title}
      description={description}
      onRetry={retryable ? retry : undefined}
      retryLabel={t('generic.action')}
      retrying={retrying}
      reference={requestId === undefined ? undefined : t('reference', { id: requestId })}
      secondaryAction={secondaryAction}
      size={size}
      headingLevel={headingLevel}
    />
  );
}
