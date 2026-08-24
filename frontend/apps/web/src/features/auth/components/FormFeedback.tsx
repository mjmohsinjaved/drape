'use client';

import { useTranslations } from 'next-intl';

import { ErrorState, PermissionDeniedState, SuccessState } from '@repo/ui';

import { useErrorCopy } from '@/features/auth/lib/error-copy';

import type { ApiError } from '@repo/api-client';
import type { ReactNode } from 'react';

export interface FormErrorFeedbackProps {
  error: ApiError;
  onRetry?: () => void;
  secondaryAction?: ReactNode;
  deniedAction?: ReactNode;
}

export function FormErrorFeedback({
  error,
  onRetry,
  secondaryAction,
  deniedAction,
}: FormErrorFeedbackProps) {
  const t = useTranslations('auth.common');
  const copy = useErrorCopy();

  if (error.isAccountBlocked) {
    return (
      <ErrorState
        size="inline"
        headingLevel="h2"
        title={t('accountBlockedTitle')}
        description={copy.message(error)}
        secondaryAction={deniedAction ?? secondaryAction}
      />
    );
  }

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
  title: string;
  description?: string;
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
