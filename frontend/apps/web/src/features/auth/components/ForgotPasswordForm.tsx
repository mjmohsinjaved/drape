'use client';

import { useState, type FormEvent } from 'react';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { TextField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { useForgotPassword } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { looksLikeEmail } from '@/features/auth/lib/password-policy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface ForgotPasswordFormProps {
  locale: Locale;
}

export function ForgotPasswordForm({ locale }: ForgotPasswordFormProps) {
  const t = useTranslations('auth.forgotPassword');
  const tc = useTranslations('auth.common');
  const copy = useErrorCopy();
  const forgot = useForgotPassword();

  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);

  const error = forgot.error;
  const emailError =
    (error ? copy.fieldMessage(error, 'email') : undefined) ??
    (touched && !looksLikeEmail(email) ? tc('fieldErrors.email') : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (forgot.isPending || !looksLikeEmail(email)) return;
    forgot.mutate({ email: email.trim() });
  }

  if (forgot.isSuccess) {
    return (
      <FormSuccessFeedback
        title={t('successTitle')}
        description={t('successBody')}
        action={
          <Button asChild variant="secondary">
            <Link href={routes.login(locale)}>{tc('backToSignIn')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error ? (
        <FormErrorFeedback
          error={error}
          onRetry={
            error.isRetryable
              ? () => {
                  forgot.reset();
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

      <TextField
        label={t('emailLabel')}
        value={email}
        onValueChange={setEmail}
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={320}
        required
        disabled={forgot.isPending}
        error={emailError}
        hint={t('emailHint')}
      />

      <Button type="submit" fullWidth loading={forgot.isPending} loadingLabel={tc('sending')}>
        {t('submit')}
      </Button>
    </form>
  );
}
