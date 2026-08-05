'use client';

import { useState, type FormEvent } from 'react';

import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

import { PasswordField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { useChangePassword } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { meetsPasswordPolicy } from '@/features/auth/lib/password-policy';

/**
 * `POST /auth/password/change` — C-7.
 *
 * The current password is required because this is exactly the action a hijacked session would
 * attempt. Changing it keeps this device signed in and signs every other one out; the notice
 * says so before the press, not after (D-13 — the control names what happens).
 *
 * ### The six D-5 states
 * - **default** — the two password fields, rules on screen from the start.
 * - **loading** — the busy save button.
 * - **empty** — not applicable.
 * - **error** — a wrong current password comes back as `INVALID_CREDENTIALS`, generically (S-6).
 * - **permission denied** — a suspended account renders the S-9 shell.
 * - **success** — confirmed, and it says the other devices are now signed out.
 */
export function ChangePasswordForm() {
  const t = useTranslations('account.password');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const copy = useErrorCopy();
  const change = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const error = change.error;
  const currentError =
    (error ? copy.fieldMessage(error, 'currentPassword') : undefined) ??
    (touched && currentPassword.length === 0 ? tc('fieldErrors.passwordRequired') : undefined);
  const newError =
    (error ? copy.fieldMessage(error, 'newPassword') : undefined) ??
    (touched && !meetsPasswordPolicy(newPassword) ? tc('fieldErrors.passwordPolicy') : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (change.isPending) return;
    if (currentPassword.length === 0 || !meetsPasswordPolicy(newPassword)) return;

    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setTouched(false);
          // The session id rotates on a password change, so the server-rendered shell above
          // has to resolve the new one.
          router.refresh();
        },
      },
    );
  }

  if (change.isSuccess && !change.isPending) {
    return (
      <FormSuccessFeedback
        title={t('savedTitle')}
        description={t('savedBody')}
        action={
          <Button
            variant="secondary"
            onClick={() => {
              change.reset();
            }}
          >
            {t('changeAgain')}
          </Button>
        }
      />
    );
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-w-prose flex-col gap-5">
      {error ? (
        <FormErrorFeedback
          error={error}
          onRetry={
            error.isRetryable
              ? () => {
                  change.reset();
                }
              : undefined
          }
        />
      ) : null}

      <Callout tone="info" title={t('noticeTitle')}>
        {t('noticeBody')}
      </Callout>

      <PasswordField
        label={t('currentLabel')}
        value={currentPassword}
        onValueChange={setCurrentPassword}
        autoComplete="current-password"
        disabled={change.isPending}
        error={currentError}
      />

      <PasswordField
        label={t('newLabel')}
        value={newPassword}
        onValueChange={setNewPassword}
        autoComplete="new-password"
        disabled={change.isPending}
        showPolicy
        error={newError}
      />

      <Button
        type="submit"
        loading={change.isPending}
        loadingLabel={tc('saving')}
        className="self-start"
      >
        {t('submit')}
      </Button>
    </form>
  );
}
