'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button, Callout, EmptyState } from '@repo/ui';

import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import {
  useConfirmEmail,
  useRequestEmailVerification,
} from '@/features/auth/hooks/use-auth-mutations';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface RequestEmailVerificationProps {
  locale: Locale;
  isSignedIn: boolean;
  alreadyVerified: boolean;
  email: string | null;
}

export function RequestEmailVerification({
  locale,
  isSignedIn,
  alreadyVerified,
  email,
}: RequestEmailVerificationProps) {
  const t = useTranslations('auth.verifyEmail');
  const tc = useTranslations('auth.common');
  const request = useRequestEmailVerification();

  if (!isSignedIn) {
    return (
      <EmptyState
        size="inline"
        headingLevel="h2"
        title={t('signedOutTitle')}
        description={t('signedOutBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.login(locale)}>{tc('signIn')}</Link>
          </Button>
        }
      />
    );
  }

  if (alreadyVerified) {
    return (
      <FormSuccessFeedback
        title={t('alreadyTitle')}
        description={t('alreadyBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.dashboard(locale)}>{tc('goToFittingRoom')}</Link>
          </Button>
        }
      />
    );
  }

  if (request.isSuccess) {
    return (
      <FormSuccessFeedback
        title={t('sentTitle')}
        description={t('sentBody')}
        action={
          <Button asChild variant="secondary">
            <Link href={routes.dashboard(locale)}>{tc('goToFittingRoom')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {request.error ? (
        <FormErrorFeedback
          error={request.error}
          onRetry={
            request.error.isRetryable
              ? () => {
                  request.reset();
                }
              : undefined
          }
          deniedAction={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{tc('backToDrape')}</Link>
            </Button>
          }
        />
      ) : null}

      {email ? (
        <Callout tone="info" title={t('addressTitle')}>
          <span className="font-mono text-sm">{email}</span>
        </Callout>
      ) : null}

      <Button
        variant="primary"
        fullWidth
        loading={request.isPending}
        loadingLabel={tc('sending')}
        onClick={() => {
          if (request.isPending) return;
          request.mutate();
        }}
      >
        {t('submit')}
      </Button>
    </div>
  );
}

export interface ConfirmEmailTokenProps {
  locale: Locale;
  token: string;
}

export function ConfirmEmailToken({ locale, token }: ConfirmEmailTokenProps) {
  const t = useTranslations('auth.verifyEmailToken');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const confirm = useConfirmEmail();

  if (confirm.isSuccess) {
    return (
      <FormSuccessFeedback
        title={t('successTitle')}
        description={t('successBody')}
        action={
          <Button
            variant="primary"
            onClick={() => {
              router.replace(routes.dashboard(locale));
              router.refresh();
            }}
          >
            {tc('goToFittingRoom')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {confirm.error ? (
        <FormErrorFeedback
          error={confirm.error}
          onRetry={
            confirm.error.isRetryable
              ? () => {
                  confirm.reset();
                }
              : undefined
          }
          secondaryAction={
            <Button asChild variant="secondary">
              <Link href={routes.verifyEmail(locale)}>{tc('sendNewLink')}</Link>
            </Button>
          }
          deniedAction={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{tc('backToDrape')}</Link>
            </Button>
          }
        />
      ) : null}

      <Button
        variant="primary"
        fullWidth
        loading={confirm.isPending}
        loadingLabel={tc('confirming')}
        onClick={() => {
          if (confirm.isPending) return;
          confirm.mutate({ token });
        }}
      >
        {t('submit')}
      </Button>
    </div>
  );
}
