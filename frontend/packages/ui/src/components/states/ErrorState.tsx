'use client';

import * as React from 'react';

import { AlertTriangle } from 'lucide-react';

import { Button } from '../button/Button';

import { StateShell, type StateShellProps } from './StateShell';

export interface ErrorStateProps extends Omit<StateShellProps, 'title' | 'action' | 'tone'> {
  /** What happened, in the interface's voice. Defaults below. */
  title?: React.ReactNode;
  /** What to do next. Defaults below. */
  description?: React.ReactNode;
  /** Wire this and the retry button appears. */
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  /** An alternative path when retrying is not the answer — "Back to the fitting room". */
  secondaryAction?: React.ReactNode;
  /** Reference id from the API envelope, shown small. It is for support, not for the user to act on. */
  reference?: string;
  /** Set while the retry is in flight. */
  retrying?: boolean;
}

/**
 * The D-7 error state.
 *
 * The default copy is written to the rule and is safe to ship untranslated-as-English while a
 * screen is being built: it states what happened and what to do next, it does not apologise, it
 * does not blame the user, and it is not vague. "Sorry, something went wrong" fails all four.
 *
 * Prefer a specific message when you have one — the API's `ErrorCode` maps to translated copy in
 * `errors.json`, and a specific cause is always better than this fallback.
 */
export const ErrorState = React.forwardRef<HTMLDivElement, ErrorStateProps>(function ErrorState(
  {
    title = 'This did not load',
    description = 'The connection dropped or the server did not answer. Try again — nothing you have saved is affected.',
    onRetry,
    retryLabel = 'Try again',
    secondaryAction,
    reference,
    retrying = false,
    ...props
  },
  ref,
) {
  return (
    <StateShell
      ref={ref}
      data-state="error"
      role="alert"
      tone="danger"
      icon={<AlertTriangle />}
      title={title}
      description={description}
      action={
        onRetry || secondaryAction ? (
          <>
            {onRetry ? (
              <Button variant="primary" onClick={onRetry} loading={retrying} loadingLabel={retryLabel}>
                {retryLabel}
              </Button>
            ) : null}
            {secondaryAction}
          </>
        ) : null
      }
      footer={reference ? <span className="font-mono">{reference}</span> : undefined}
      {...props}
    />
  );
});
