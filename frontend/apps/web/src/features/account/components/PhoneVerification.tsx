'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, EmptyState } from '@repo/ui';

import { OtpField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { useRequestPhoneOtp, useVerifyPhoneOtp } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { isOtpComplete } from '@/features/auth/lib/password-policy';
import { routes } from '@/lib/routes';

import type { MyAccount } from '@/features/account/api/types';
import type { Locale } from '@/i18n/config';

/**
 * Phone confirmation by OTP — C-3.
 *
 * The number is only needed before an enquiry is sent, so the copy explains what confirming it
 * unlocks rather than nagging about an incomplete profile. Someone browsing the collection is
 * not doing anything wrong by leaving it unconfirmed.
 *
 * ### The six D-5 states
 * - **default** — the send-a-code control, then the six-digit field.
 * - **loading** — the busy buttons.
 * - **empty** — no number on the account: the screen points at adding one on the profile form.
 * - **error** — `OTP_INVALID`, `OTP_EXPIRED`, `OTP_MAX_ATTEMPTS`, each with what to do next.
 * - **permission denied** — a suspended account renders the S-9 shell.
 * - **success** — confirmed.
 */
export interface PhoneVerificationProps {
  locale: Locale;
  account: MyAccount;
}

export function PhoneVerification({ locale, account }: PhoneVerificationProps) {
  const t = useTranslations('account.phone');
  const tc = useTranslations('auth.common');
  const router = useRouter();
  const copy = useErrorCopy();

  const request = useRequestPhoneOtp();
  const verify = useVerifyPhoneOtp();

  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);

  if (account.phone === null) {
    return (
      <EmptyState
        size="inline"
        headingLevel="h3"
        title={t('noNumberTitle')}
        description={t('noNumberBody')}
        action={
          <Button asChild variant="primary">
            <Link href={routes.account(locale)}>{t('addNumberAction')}</Link>
          </Button>
        }
      />
    );
  }

  if (account.phoneVerified || verify.isSuccess) {
    return (
      <FormSuccessFeedback title={t('confirmedTitle')} description={t('confirmedBody')}>
        <p className="flex items-center gap-2 font-mono text-sm text-ink">
          <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
          {account.phone}
        </p>
      </FormSuccessFeedback>
    );
  }

  function submitCode(value: string) {
    setTouched(true);
    if (verify.isPending || !isOtpComplete(value)) return;
    verify.mutate(
      { code: value },
      {
        onSuccess: () => {
          router.refresh();
        },
      },
    );
  }

  const activeError = verify.error ?? request.error;
  const codeError =
    (verify.error ? copy.fieldMessage(verify.error, 'code') : undefined) ??
    (touched && !isOtpComplete(code) ? tc('fieldErrors.otp') : undefined);

  return (
    <div className="flex flex-col gap-5">
      {activeError ? (
        <FormErrorFeedback
          error={activeError}
          onRetry={
            activeError.isRetryable
              ? () => {
                  verify.reset();
                  request.reset();
                }
              : undefined
          }
        />
      ) : null}

      <p className="text-sm text-ink-muted">{t('intro', { phone: account.phone })}</p>

      <Button
        variant="secondary"
        className="self-start"
        loading={request.isPending}
        loadingLabel={tc('sending')}
        onClick={() => {
          if (request.isPending) return;
          request.mutate({});
        }}
      >
        {request.isSuccess ? t('resendAction') : t('sendAction')}
      </Button>

      {request.isSuccess ? (
        <>
          <OtpField
            label={t('codeLabel')}
            value={code}
            onValueChange={setCode}
            onComplete={submitCode}
            hint={t('codeHint')}
            disabled={verify.isPending}
            error={codeError}
          />
          <Button
            variant="primary"
            className="self-start"
            loading={verify.isPending}
            loadingLabel={tc('confirming')}
            onClick={() => {
              submitCode(code);
            }}
          >
            {t('confirmAction')}
          </Button>
        </>
      ) : null}
    </div>
  );
}
