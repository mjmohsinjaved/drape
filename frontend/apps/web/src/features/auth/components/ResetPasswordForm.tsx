'use client';

import { useState, type FormEvent } from 'react';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { PasswordField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { useResetPassword } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { meetsPasswordPolicy } from '@/features/auth/lib/password-policy';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

/**
 * `POST /auth/password/reset` — S-6. Single-use token, 30-minute life.
 *
 * The token comes from the URL, never from a field: it is a credential, and a credential in an
 * editable box invites someone to paste one they were sent by mistake.
 *
 * A dead token is not a dead end. `TOKEN_INVALID`, `TOKEN_EXPIRED` and `TOKEN_ALREADY_USED`
 * each say what happened and offer the one thing that fixes it — request a new link (D-7).
 *
 * ### The six D-5 states
 * - **default** — the new-password field, with the rules on screen from the start.
 * - **loading** — the busy submit button, plus the segment's `loading.tsx`.
 * - **empty** — not applicable.
 * - **error** — the token codes, each with "send a new link" beside them.
 * - **permission denied** — a deletion in progress renders the S-9 shell.
 * - **success** — confirmed, with sign-in as the next step. Every session is now signed out.
 */
export interface ResetPasswordFormProps {
  locale: Locale;
  token: string;
}

export function ResetPasswordForm({ locale, token }: ResetPasswordFormProps) {
  const t = useTranslations('auth.resetPasswordToken');
  const tc = useTranslations('auth.common');
  const copy = useErrorCopy();
  const reset = useResetPassword();

  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const error = reset.error;
  const passwordError =
    (error ? copy.fieldMessage(error, 'password') : undefined) ??
    (touched && !meetsPasswordPolicy(password) ? tc('fieldErrors.passwordPolicy') : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (reset.isPending || !meetsPasswordPolicy(password)) return;
    reset.mutate({ token, password });
  }

  if (reset.isSuccess) {
    return (
      <FormSuccessFeedback
        title={t('successTitle')}
        description={t('successBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.login(locale)}>{tc('signIn')}</Link>
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
                  reset.reset();
                }
              : undefined
          }
          secondaryAction={
            <Button asChild variant="secondary">
              <Link href={routes.forgotPassword(locale)}>{tc('sendNewLink')}</Link>
            </Button>
          }
          deniedAction={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{tc('backToFittingRoom')}</Link>
            </Button>
          }
        />
      ) : null}

      <PasswordField
        label={t('passwordLabel')}
        value={password}
        onValueChange={setPassword}
        autoComplete="new-password"
        disabled={reset.isPending}
        showPolicy
        error={passwordError}
      />

      <Button type="submit" fullWidth loading={reset.isPending} loadingLabel={tc('saving')}>
        {t('submit')}
      </Button>
    </form>
  );
}
