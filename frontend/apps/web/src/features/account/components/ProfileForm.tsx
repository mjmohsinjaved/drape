'use client';

import { useState, type FormEvent } from 'react';

import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

import { SelectField } from '@/features/account/components/SelectField';
import { useUpdateMyAccount } from '@/features/account/hooks/use-account-mutations';
import { TextField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { isE164 } from '@/features/auth/lib/password-policy';
import { localeLabels } from '@/i18n/config';

import type { MyAccount ,Locale as ApiLocaleValue } from '@repo/api-client';


/**
 * `PATCH /me` — name, phone and the interface language (C-7).
 *
 * Email is not editable here. Changing an address is an identity change: it needs
 * re-verification, and the API keeps it in `auth` for that reason. The address is shown so she
 * can see which one we hold, with its confirmation state beside it.
 *
 * Changing the phone number clears its confirmation, and the form says so **before** the save
 * rather than surprising her with an unverified number at the next enquiry (C-3).
 *
 * ### The six D-5 states
 * - **default** — the three fields.
 * - **loading** — the busy save button, plus the segment's `loading.tsx`.
 * - **empty** — not applicable; an account always has a name and an address.
 * - **error** — `PHONE_ALREADY_EXISTS` and the transport failures.
 * - **permission denied** — a suspended account renders the S-9 shell.
 * - **success** — "Saved", in the same words as the control (D-13).
 */
export interface ProfileFormProps {
  account: MyAccount;
}

const LOCALE_VALUES: readonly ApiLocaleValue[] = ['EN', 'UR'];

export function ProfileForm({ account }: ProfileFormProps) {
  const t = useTranslations('account.profileForm');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const copy = useErrorCopy();
  const update = useUpdateMyAccount();

  const [name, setName] = useState(account.name);
  const [phone, setPhone] = useState(account.phone ?? '');
  const [locale, setLocale] = useState<string>(account.locale);
  const [touched, setTouched] = useState(false);

  const error = update.error;
  const phoneChanged = phone.trim() !== (account.phone ?? '');

  const nameError =
    (error ? copy.fieldMessage(error, 'name') : undefined) ??
    (touched && name.trim().length < 2 ? tc('fieldErrors.name') : undefined);
  const phoneError =
    (error ? copy.fieldMessage(error, 'phone') : undefined) ??
    (touched && phone.trim().length > 0 && !isE164(phone) ? tc('fieldErrors.phone') : undefined);

  const isValid = name.trim().length >= 2 && (phone.trim().length === 0 || isE164(phone));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (update.isPending || !isValid) return;

    update.mutate(
      {
        name: name.trim(),
        ...(phone.trim().length > 0 ? { phone: phone.trim() } : {}),
        locale: locale === 'UR' ? 'UR' : 'EN',
      },
      {
        onSuccess: () => {
          // The shell renders her name and the language decides the document direction, so the
          // Server Components above have to resolve again.
          router.refresh();
        },
      },
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
                  update.reset();
                }
              : undefined
          }
        />
      ) : null}

      {update.isSuccess && !update.isPending ? (
        <FormSuccessFeedback title={t('savedTitle')} description={t('savedBody')} />
      ) : null}

      <TextField
        label={t('nameLabel')}
        value={name}
        onValueChange={setName}
        autoComplete="name"
        maxLength={120}
        required
        disabled={update.isPending}
        error={nameError}
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
        disabled={update.isPending}
        error={phoneError}
        hint={t('phoneHint')}
      />

      {phoneChanged ? (
        <Callout tone="warning" title={t('phoneChangeTitle')}>
          {t('phoneChangeBody')}
        </Callout>
      ) : null}

      <SelectField
        label={t('localeLabel')}
        value={locale}
        onValueChange={setLocale}
        options={LOCALE_VALUES.map((value) => ({
          value,
          label: localeLabels[value === 'UR' ? 'ur' : 'en'],
        }))}
        placeholder={t('localePlaceholder')}
        hint={t('localeHint')}
        disabled={update.isPending}
      />

      <Button
        type="submit"
        loading={update.isPending}
        loadingLabel={tc('saving')}
        className="self-start"
      >
        {t('submit')}
      </Button>
    </form>
  );
}
