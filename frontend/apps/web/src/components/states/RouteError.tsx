'use client';

import { useTranslations } from 'next-intl';

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
 * `error.digest` is shown as a plain reference the user can quote to us. It is not a status
 * code and not a stack trace — no screen shows either (§8.1). `ErrorState` owns both the retry
 * button (`onRetry`) and the reference line (`reference`), so neither is rebuilt here.
 */
export function RouteError({ error, reset, scope }: RouteErrorViewProps) {
  const t = useTranslations('errors');

  // In production Next replaces a server-side message with a digest, so we only display a
  // message when the boundary genuinely received one worth reading.
  const hasMessage = error.message.length > 0 && error.message.length < 200;

  return (
    <ErrorState
      title={scope ? t(`scoped.${scope}.title`) : t('generic.title')}
      description={hasMessage ? error.message : t('generic.body')}
      onRetry={reset}
      retryLabel={t('generic.action')}
      reference={error.digest ? t('reference', { id: error.digest }) : undefined}
    />
  );
}
