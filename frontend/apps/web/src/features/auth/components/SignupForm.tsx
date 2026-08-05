'use client';

import { useState, type FormEvent } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

import { TextField, PasswordField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { useSignup } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { isE164, looksLikeEmail, meetsPasswordPolicy } from '@/features/auth/lib/password-policy';
import { apiLocale, type Locale } from '@/i18n/config';
import { routes } from '@/lib/routes';

/**
 * The C-2 signup form. Name, email, password, phone — and nothing else.
 *
 * **Event date, event type and budget band are deliberately absent.** C-2 says they are
 * optional and prompted later, in context; they live on the account profile screen and on the
 * enquiry flow, where the question makes sense to the person answering it. Adding them here
 * would turn a one-minute signup into a form about a wedding.
 *
 * The password rules are on screen from the first keystroke, not reported after a rejection.
 *
 * S-4: this route creates a Consumer account and only a Consumer account. There is no role
 * field on this form, and a role in the payload would be stripped and audit-logged by the API
 * rather than honoured.
 *
 * ### The six D-5 states
 * - **default** — the four fields.
 * - **loading** — the busy submit button, plus the segment's `loading.tsx`.
 * - **empty** — not applicable.
 * - **error** — `FormErrorFeedback`; `EMAIL_ALREADY_EXISTS` points at signing in instead.
 * - **permission denied** — a deletion already in progress renders the S-9 shell.
 * - **success** — `FormSuccessFeedback`, naming the next step rather than just confirming.
 */
export interface SignupFormProps {
  locale: Locale;
}

export function SignupForm({ locale }: SignupFormProps) {
  const t = useTranslations('auth.signup');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const copy = useErrorCopy();
  const signup = useSignup();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);

  const error = signup.error;
  const created = signup.data;

  const nameError =
    (error ? copy.fieldMessage(error, 'name') : undefined) ??
    (touched && name.trim().length === 0 ? tc('fieldErrors.name') : undefined);
  const emailError =
    (error ? copy.fieldMessage(error, 'email') : undefined) ??
    (touched && !looksLikeEmail(email) ? tc('fieldErrors.email') : undefined);
  const passwordError =
    (error ? copy.fieldMessage(error, 'password') : undefined) ??
    (touched && !meetsPasswordPolicy(password) ? tc('fieldErrors.passwordPolicy') : undefined);
  const phoneError =
    (error ? copy.fieldMessage(error, 'phone') : undefined) ??
    (touched && !isE164(phone) ? tc('fieldErrors.phone') : undefined);

  const isValid =
    name.trim().length > 0 &&
    looksLikeEmail(email) &&
    meetsPasswordPolicy(password) &&
    isE164(phone);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (signup.isPending || !isValid) return;

    signup.mutate({
      name: name.trim(),
      email: email.trim(),
      password,
      phone: phone.trim(),
      locale: apiLocale[locale],
    });
  }

  if (created) {
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
            {t('successAction')}
          </Button>
        }
      >
        {created.emailVerifiedAt === null ? (
          <Callout tone="info" title={t('confirmEmailTitle')}>
            {t('confirmEmailBody')}
          </Callout>
        ) : null}
      </FormSuccessFeedback>
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
                  signup.reset();
                }
              : undefined
          }
          secondaryAction={
            error.is('EMAIL_ALREADY_EXISTS') ? (
              <Button asChild variant="secondary">
                <Link href={routes.login(locale)}>{tc('signInInstead')}</Link>
              </Button>
            ) : undefined
          }
          deniedAction={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{tc('backToFittingRoom')}</Link>
            </Button>
          }
        />
      ) : null}

      <TextField
        label={t('nameLabel')}
        value={name}
        onValueChange={setName}
        autoComplete="name"
        maxLength={120}
        required
        disabled={signup.isPending}
        error={nameError}
        hint={t('nameHint')}
      />

      <TextField
        label={t('emailLabel')}
        value={email}
        onValueChange={setEmail}
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={320}
        required
        disabled={signup.isPending}
        error={emailError}
      />

      <TextField
        label={t('phoneLabel')}
        value={phone}
        onValueChange={setPhone}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+923001234567"
        maxLength={16}
        required
        disabled={signup.isPending}
        error={phoneError}
        hint={t('phoneHint')}
      />

      <PasswordField
        label={t('passwordLabel')}
        value={password}
        onValueChange={setPassword}
        autoComplete="new-password"
        disabled={signup.isPending}
        showPolicy
        error={passwordError}
      />

      <Button
        type="submit"
        fullWidth
        loading={signup.isPending}
        loadingLabel={tc('creatingAccount')}
      >
        {t('submit')}
      </Button>
    </form>
  );
}
