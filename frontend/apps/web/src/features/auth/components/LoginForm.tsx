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

/**
 * The S-1 sign-in form. One form for both roles.
 *
 * **Nothing here asks or reveals which kind of account the caller holds**, and nothing
 * distinguishes an unknown address from a wrong password: the API answers `INVALID_CREDENTIALS`
 * for both, and this screen renders the one sentence that code maps to (S-6). There is no
 * client-side "we don't know that email" branch, and there cannot be one — the response carries
 * no such fact.
 *
 * On success the caller lands on `/dashboard` (C-4), which resolves the role server-side and
 * renders the right experience behind the one URL (S-2).
 *
 * ### The six D-5 states
 * - **default** — the two fields below.
 * - **loading** — the busy submit button, plus the segment's `loading.tsx` skeleton.
 * - **empty** — not applicable: a sign-in form has no collection to be empty.
 * - **error** — `FormErrorFeedback`, resolved from the code, in the reader's language.
 * - **permission denied** — a suspended or deactivated account renders the S-9 shell.
 * - **success** — the navigation itself; the fitting room is the confirmation.
 */
export interface LoginFormProps {
  locale: Locale;
}

/**
 * Only a same-site path is honoured as a return target. An absolute URL, or a protocol-relative
 * `//host`, would turn the sign-in screen into an open redirect.
 */
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

    // No double submit: the button is disabled while busy and the handler refuses a second run.
    if (login.isPending) return;
    if (!looksLikeEmail(email) || password.length === 0) return;

    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => {
          router.replace(returnTo ?? routes.dashboard(locale));
          // The session cookie is new, so every Server Component above resolves it again.
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
              <Link href={routes.home(locale)}>{tc('backToFittingRoom')}</Link>
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
