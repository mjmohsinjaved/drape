'use client';

import { useState, type FormEvent } from 'react';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Button, Callout, DescriptionItem, DescriptionList } from '@repo/ui';

import { TextField, PasswordField } from '@/features/auth/components/fields';
import { FormErrorFeedback } from '@/features/auth/components/FormFeedback';
import { TwoFactorEnrolment } from '@/features/auth/components/TwoFactorEnrolment';
import { useAcceptInvite } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { meetsPasswordPolicy } from '@/features/auth/lib/password-policy';
import { apiLocale, type Locale } from '@/i18n/config';
import { routes } from '@/lib/routes';

import type { InvitePreview } from '@/features/auth/api/types';

/**
 * Invitation acceptance — S-5, `POST /invites/token/:token/accept`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  THE ROLE IS NEVER A FORM FIELD.
 *
 *  It comes from the invite row the token resolves to, and the request body has no field
 *  that could carry one — nor an email, for the same reason. This screen *displays* the
 *  role from the server-validated preview so the reader knows what they are accepting; it
 *  never submits it. There is no code path from this form to an admin account other than
 *  an admin having sent the invitation (S-4, S-5).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Acceptance signs the new admin in and S-8 then makes two-factor enrolment mandatory, so the
 * enrolment panel takes over this screen rather than sending them somewhere else to find it.
 *
 * ### The six D-5 states
 * - **default** — the preview, then name and password.
 * - **loading** — the busy submit button, plus the segment's `loading.tsx`.
 * - **empty** — not applicable; the invalid-token case is handled by the page above.
 * - **error** — the three invite codes, each saying to ask an admin for a new invitation.
 * - **permission denied** — handled by the page's server-side preview and the S-9 shell.
 * - **success** — the 2FA enrolment step, which is the actual next thing to do.
 */
export interface InviteAcceptanceFormProps {
  locale: Locale;
  token: string;
  preview: InvitePreview;
}

export function InviteAcceptanceForm({ locale, token, preview }: InviteAcceptanceFormProps) {
  const t = useTranslations('auth.invite');
  const tc = useTranslations('auth.common');
  const copy = useErrorCopy();
  const accept = useAcceptInvite(token);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const error = accept.error;
  const nameError =
    (error ? copy.fieldMessage(error, 'name') : undefined) ??
    (touched && name.trim().length === 0 ? tc('fieldErrors.name') : undefined);
  const passwordError =
    (error ? copy.fieldMessage(error, 'password') : undefined) ??
    (touched && !meetsPasswordPolicy(password) ? tc('fieldErrors.passwordPolicy') : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (accept.isPending) return;
    if (name.trim().length === 0 || !meetsPasswordPolicy(password)) return;

    accept.mutate({ name: name.trim(), password, locale: apiLocale[locale] });
  }

  if (accept.data) {
    return (
      <div className="flex flex-col gap-5">
        <Callout tone="success" title={t('createdTitle')}>
          {t('createdBody')}
        </Callout>
        <TwoFactorEnrolment
          required
          completionAction={
            <Button asChild variant="primary">
              <Link href={routes.dashboard(locale)}>{tc('goToConsole')}</Link>
            </Button>
          }
        />
      </div>
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
                  accept.reset();
                }
              : undefined
          }
          secondaryAction={
            <Button asChild variant="secondary">
              <Link href={routes.login(locale)}>{tc('backToSignIn')}</Link>
            </Button>
          }
          deniedAction={
            <Button asChild variant="secondary">
              <Link href={routes.home(locale)}>{tc('backToFittingRoom')}</Link>
            </Button>
          }
        />
      ) : null}

      {/* Read-only, straight from the server-validated preview. Not inputs — facts. */}
      <DescriptionList>
        <DescriptionItem term={t('previewEmail')}>{preview.email}</DescriptionItem>
        <DescriptionItem term={t('previewRole')}>{t(`roles.${preview.role}`)}</DescriptionItem>
      </DescriptionList>

      <TextField
        label={t('nameLabel')}
        value={name}
        onValueChange={setName}
        autoComplete="name"
        maxLength={120}
        required
        disabled={accept.isPending}
        error={nameError}
        hint={t('nameHint')}
      />

      <PasswordField
        label={t('passwordLabel')}
        value={password}
        onValueChange={setPassword}
        autoComplete="new-password"
        disabled={accept.isPending}
        showPolicy
        error={passwordError}
      />

      <Button
        type="submit"
        fullWidth
        loading={accept.isPending}
        loadingLabel={tc('creatingAccount')}
      >
        {t('submit')}
      </Button>
    </form>
  );
}
