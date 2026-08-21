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

import type { InviteTokenPreview } from '@repo/api-client';

export interface InviteAcceptanceFormProps {
  locale: Locale;
  token: string;
  preview: InviteTokenPreview;
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
          completionAction={
            <Button asChild variant="primary">
              <Link href={routes.dashboard(locale)}>{tc('goToConsole')}</Link>
            </Button>
          }
          skipAction={
            <Button asChild variant="secondary">
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
              <Link href={routes.home(locale)}>{tc('backToDrape')}</Link>
            </Button>
          }
        />
      ) : null}

      {}
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
