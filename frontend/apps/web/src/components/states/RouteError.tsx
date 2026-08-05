'use client';

import { useTranslations } from 'next-intl';

import { useErrorCopy } from '@repo/api-client';
import { ErrorState } from '@repo/ui';

import type { RouteErrorProps } from '@/lib/route-params';

export interface RouteErrorViewProps extends RouteErrorProps {
  /**
   * A namespace-qualified key under `errors` describing what this segment was doing, e.g.
   * `catalog`. Falls back to the generic wording when the segment has nothing specific to say.
   */
  scope?: string;
}

/**
 * The shared body of every `error.tsx` — D-5 error state, D-7 wording.
 *
 * It says what happened and what to do next, in the interface's voice. It does not apologise,
 * does not blame, and is never vague. The retry is always present because `reset()` always
 * exists at a route boundary.
 *
 * A plain reference the user can quote to us is shown, and it is not a status code or a stack
 * trace — no screen shows either (§8.1). `ErrorState` owns both the retry button (`onRetry`) and
 * the reference line (`reference`), so neither is rebuilt here.
 *
 * ═══ It never renders `error.message` ═══
 *
 * It used to, guarded on the message being short enough to read. Next only strips a message on a
 * **server** throw; a client-side `ApiError` reaches this boundary with its `message` intact, and
 * that message is the API's own English (§2.3, §8.3). So an Urdu reader hit a failure and got an
 * English sentence in the middle of an otherwise Urdu screen — the exact thing C-41 and the
 * `useErrorCopy` contract exist to prevent, still happening in the one place every screen falls
 * back to. The code is resolved instead, and looked up in `errors.codes`, which degrades to a
 * translated `description` for a code this build has never heard of.
 */
export function RouteError({ error, reset, scope }: RouteErrorViewProps) {
  const t = useTranslations('errors');
  const copy = useErrorCopy('errors.codes');

  const reference = referenceId(error);

  return (
    <ErrorState
      title={scope ? t(`scoped.${scope}.title`) : t('generic.title')}
      description={copy.message(error)}
      onRetry={reset}
      retryLabel={t('generic.action')}
      reference={reference === undefined ? undefined : t('reference', { id: reference })}
    />
  );
}

/**
 * The id the studio can correlate with, in order of usefulness.
 *
 * An `ApiError` thrown inside a Client Component reaches this boundary intact, still carrying
 * the `X-Request-Id` the API stamped on the response — and because E-12 keeps personal data out
 * of the logs, that id is the only correlator that exists. Next's `digest` is the fallback: it
 * identifies a *server* throw, which is the only kind whose message gets stripped in production.
 */
function referenceId(error: Error & { digest?: string }): string | undefined {
  const requestId: unknown = (error as { requestId?: unknown }).requestId;
  if (typeof requestId === 'string' && requestId.length > 0) return requestId;
  return error.digest !== undefined && error.digest.length > 0 ? error.digest : undefined;
}
