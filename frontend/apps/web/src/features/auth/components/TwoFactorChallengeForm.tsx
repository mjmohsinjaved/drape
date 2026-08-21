'use client';

import { useState, type FormEvent } from 'react';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button } from '@repo/ui';

import { OtpField, TextField } from '@/features/auth/components/fields';
import { FormErrorFeedback } from '@/features/auth/components/FormFeedback';
import {
  useTwoFactorChallenge,
  useTwoFactorRecovery,
} from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { isOtpComplete } from '@/features/auth/lib/password-policy';
import { RETURN_TO_PARAM } from '@/lib/constants';
import { routes } from '@/lib/routes';

import type { Locale } from '@/i18n/config';

export interface TwoFactorChallengeFormProps {
  locale: Locale;
}

function safeReturnTo(value: string | null): string | null {
  if (value === null) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

export function TwoFactorChallengeForm({ locale }: TwoFactorChallengeFormProps) {
  const t = useTranslations('auth.twoFactor');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = useErrorCopy();

  const challenge = useTwoFactorChallenge();
  const recovery = useTwoFactorRecovery();

  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [touched, setTouched] = useState(false);

  const returnTo = safeReturnTo(searchParams.get(RETURN_TO_PARAM));
  const active = mode === 'code' ? challenge : recovery;
  const error = active.error;

  function land() {
    router.replace(returnTo ?? routes.dashboard(locale));
    router.refresh();
  }

  function submitCode(value: string) {
    if (challenge.isPending || !isOtpComplete(value)) return;
    challenge.mutate({ code: value }, { onSuccess: land });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    if (mode === 'code') {
      submitCode(code);
      return;
    }

    if (recovery.isPending || recoveryCode.trim().length === 0) return;
    recovery.mutate({ recoveryCode: recoveryCode.trim() }, { onSuccess: land });
  }

  const codeError =
    (error ? copy.fieldMessage(error, 'code') : undefined) ??
    (touched && mode === 'code' && !isOtpComplete(code) ? tc('fieldErrors.otp') : undefined);
  const recoveryError =
    (error ? copy.fieldMessage(error, 'recoveryCode') : undefined) ??
    (touched && mode === 'recovery' && recoveryCode.trim().length === 0
      ? tc('fieldErrors.recoveryCode')
      : undefined);

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error ? (
        <FormErrorFeedback
          error={error}
          onRetry={
            error.isRetryable
              ? () => {
                  active.reset();
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

      {mode === 'code' ? (
        <OtpField
          label={t('codeLabel')}
          value={code}
          onValueChange={setCode}
          onComplete={submitCode}
          hint={t('codeHint')}
          disabled={challenge.isPending}
          error={codeError}
          autoFocus
        />
      ) : (
        <TextField
          label={t('recoveryLabel')}
          value={recoveryCode}
          onValueChange={setRecoveryCode}
          autoComplete="one-time-code"
          maxLength={32}
          required
          disabled={recovery.isPending}
          error={recoveryError}
          hint={t('recoveryHint')}
          autoFocus
        />
      )}

      <Button type="submit" fullWidth loading={active.isPending} loadingLabel={tc('signingIn')}>
        {t('submit')}
      </Button>

      <Button
        type="button"
        variant="link"
        onClick={() => {
          setTouched(false);
          challenge.reset();
          recovery.reset();
          setMode((current) => (current === 'code' ? 'recovery' : 'code'));
        }}
      >
        {mode === 'code' ? t('useRecovery') : t('useCode')}
      </Button>
    </form>
  );
}
