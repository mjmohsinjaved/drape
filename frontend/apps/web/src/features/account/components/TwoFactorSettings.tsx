'use client';

import { useState, type FormEvent } from 'react';

import { useRouter } from 'next/navigation';

import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Callout } from '@repo/ui';

import { OtpField, PasswordField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { TwoFactorEnrolment } from '@/features/auth/components/TwoFactorEnrolment';
import { useTwoFactorDisable } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { isOtpComplete } from '@/features/auth/lib/password-policy';

import type { MyAccount } from '@repo/api-client';

export interface TwoFactorSettingsProps {
  account: MyAccount;
}

export function TwoFactorSettings({ account }: TwoFactorSettingsProps) {
  const t = useTranslations('account.twoFactor');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const copy = useErrorCopy();
  const disable = useTwoFactorDisable();

  const [showDisable, setShowDisable] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);

  if (!account.twofaEnabled) {
    return (
      <TwoFactorEnrolment
        completionAction={
          <Button
            variant="secondary"
            onClick={() => {
              router.refresh();
            }}
          >
            {t('doneAction')}
          </Button>
        }
      />
    );
  }

  if (disable.isSuccess) {
    return (
      <FormSuccessFeedback
        title={t('disabledTitle')}
        description={t('disabledBody')}
        action={
          <Button
            variant="secondary"
            onClick={() => {
              disable.reset();
              router.refresh();
            }}
          >
            {t('turnOnAgain')}
          </Button>
        }
      />
    );
  }

  function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (disable.isPending) return;
    if (password.length === 0 || !isOtpComplete(code)) return;

    disable.mutate(
      { currentPassword: password, code },
      {
        onSuccess: () => {
          setPassword('');
          setCode('');
          router.refresh();
        },
      },
    );
  }

  const passwordError =
    (disable.error ? copy.fieldMessage(disable.error, 'currentPassword') : undefined) ??
    (touched && password.length === 0 ? tc('fieldErrors.passwordRequired') : undefined);
  const codeError =
    (disable.error ? copy.fieldMessage(disable.error, 'code') : undefined) ??
    (touched && !isOtpComplete(code) ? tc('fieldErrors.otp') : undefined);

  return (
    <div className="flex max-w-prose flex-col gap-5">
      {disable.error ? (
        <FormErrorFeedback
          error={disable.error}
          onRetry={
            disable.error.isRetryable
              ? () => {
                  disable.reset();
                }
              : undefined
          }
        />
      ) : null}

      <Callout
        tone="success"
        title={t('onTitle')}
        icon={<ShieldCheck aria-hidden="true" className="size-5" />}
      >
        {t('onBody')}
      </Callout>

      {showDisable ? (
        <form noValidate onSubmit={handleDisable} className="flex flex-col gap-5">
          <p className="text-sm text-ink-muted">{t('disableIntro')}</p>

          <PasswordField
            label={t('disablePasswordLabel')}
            value={password}
            onValueChange={setPassword}
            autoComplete="current-password"
            disabled={disable.isPending}
            error={passwordError}
          />

          <OtpField
            label={t('disableCodeLabel')}
            value={code}
            onValueChange={setCode}
            hint={t('disableCodeHint')}
            disabled={disable.isPending}
            error={codeError}
          />

          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              variant="danger"
              loading={disable.isPending}
              loadingLabel={tc('turningOff')}
            >
              {t('disableAction')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowDisable(false);
                setTouched(false);
                disable.reset();
              }}
            >
              {tc('cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setShowDisable(true);
          }}
        >
          {t('disableAction')}
        </Button>
      )}
    </div>
  );
}
