'use client';

import { useTranslations } from 'next-intl';

import { ErrorState, PermissionDeniedState, SuccessState } from '@repo/ui';

import { useErrorCopy } from '@/features/auth/lib/error-copy';

import type { ApiError } from '@repo/api-client';
import type { ReactNode } from 'react';

/**
 * The three D-5 states a form renders in place of, or beside, its fields.
 *
 * They come from `@repo/ui` rather than being hand-rolled per screen, so the wording rules
 * (D-6, D-7, D-13) and the S-9 no-access rule are enforced by the shell instead of remembered
 * by whoever writes the next form.
 *
 * The other three states are the form itself (**default**), the busy submit button and the
 * segment's `loading.tsx` skeleton (**loading**), and — where a screen has a collection —
 * `EmptyState` (**empty**).
 */

export interface FormErrorFeedbackProps {
  error: ApiError;
  /** Offered only when trying the same request again could plausibly work (D-7). */
  onRetry?: () => void;
  /** An alternative route out — "Send a new link", "Back to sign in". */
  secondaryAction?: ReactNode;
  /** Where the S-9 screen sends someone whose account may not do this. */
  deniedAction?: ReactNode;
}

/**
 * Error, or permission denied — the code decides which.
 *
 * `error.isPermissionDenied` is the one classification in the app (`@repo/api-client`), not a
 * list maintained here. A dropped session is deliberately *not* in it: on a form, "your session
 * has ended, sign in again" belongs beside the fields she has just filled in, not on a screen
 * that replaces them.
 *
 * Neither branch renders `error.message` or `error.requestId`: the copy is resolved locally
 * from the code so it is translated in both locales, and a correlation id is not something the
 * user can act on.
 */
export function FormErrorFeedback({
  error,
  onRetry,
  secondaryAction,
  deniedAction,
}: FormErrorFeedbackProps) {
  const t = useTranslations('auth.common');
  const copy = useErrorCopy();

  if (error.isPermissionDenied) {
    return (
      <PermissionDeniedState
        size="inline"
        headingLevel="h2"
        description={copy.message(error)}
        action={deniedAction}
      />
    );
  }

  return (
    <ErrorState
      size="inline"
      headingLevel="h2"
      title={t('errorTitle')}
      description={copy.message(error)}
      onRetry={onRetry}
      retryLabel={t('tryAgain')}
      secondaryAction={secondaryAction}
    />
  );
}

export interface FormSuccessFeedbackProps {
  /** Confirms in the same words as the control that caused it (D-13). */
  title: string;
  description?: string;
  /** The next step. Nearly every success worth showing has one. */
  action?: ReactNode;
  children?: ReactNode;
}

export function FormSuccessFeedback({
  title,
  description,
  action,
  children,
}: FormSuccessFeedbackProps) {
  return (
    <SuccessState
      size="inline"
      headingLevel="h2"
      title={title}
      description={description}
      action={action}
    >
      {children}
    </SuccessState>
  );
}
