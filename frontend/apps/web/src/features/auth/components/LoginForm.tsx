'use client';

import { useState, type FormEvent } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { TextField, PasswordField } from '@/features/auth/components/fields';
import { FormErrorFeedback } from '@/features/auth/components/FormFeedback';
import { useLogin } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { looksLikeEmail } from '@/features/auth/lib/password-policy';
import { RETURN_TO_PARAM } from '@/lib/constants';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface LoginFormProps {
  locale: Locale;
}

function safeReturnTo(value: string | null): string | null {
  if (value === null) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

export function LoginForm({ locale }: LoginFormProps) {
  const t = useTranslations('auth.login');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = useErrorCopy();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const returnTo = safeReturnTo(searchParams.get(RETURN_TO_PARAM));
  const error = login.error;

  const emailError =
    (error ? copy.fieldMessage(error, 'email') : undefined) ??
    (touched && !looksLikeEmail(email) ? tc('fieldErrors.email') : undefined);
  const passwordError =
    (error ? copy.fieldMessage(error, 'password') : undefined) ??
    (touched && password.length === 0 ? tc('fieldErrors.passwordRequired') : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    if (login.isPending) return;
    if (!looksLikeEmail(email) || password.length === 0) return;

    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (result) => {
          if (result.twofaRequired) {
            const target = returnTo
              ? `${routes.twoFactor(locale)}?${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`
              : routes.twoFactor(locale);
            router.replace(target);
            return;
          }
          router.replace(returnTo ?? routes.dashboard(locale));
          router.refresh();
        },
      },
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
                  login.reset();
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
        disabled={login.isPending}
        error={emailError}
      />

      <PasswordField
        label={t('passwordLabel')}
        value={password}
        onValueChange={setPassword}
        autoComplete="current-password"
        disabled={login.isPending}
        error={passwordError}
      />

      <Button type="submit" fullWidth loading={login.isPending} loadingLabel={tc('signingIn')}>
        {t('submit')}
      </Button>

      <Link
        href={routes.forgotPassword(locale)}
        className="inline-flex min-h-11 items-center self-start text-sm text-brand underline underline-offset-4"
      >
        {t('forgotPassword')}
      </Link>
    </form>
  );
}
