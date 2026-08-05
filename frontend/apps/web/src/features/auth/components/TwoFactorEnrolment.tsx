'use client';

import { useState, type ReactNode } from 'react';

import { KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Callout, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import { OtpField } from '@/features/auth/components/fields';
import { FormErrorFeedback, FormSuccessFeedback } from '@/features/auth/components/FormFeedback';
import { useTwoFactorEnable, useTwoFactorSetup } from '@/features/auth/hooks/use-auth-mutations';
import { useErrorCopy } from '@/features/auth/lib/error-copy';
import { isOtpComplete } from '@/features/auth/lib/password-policy';

/**
 * Two-factor enrolment — S-8.
 *
 * Mandatory for admins, optional for consumers. The same three steps serve both: start, confirm
 * a live code, then read the recovery codes once.
 *
 * ### What the API returns, and what this renders
 *
 * `POST /auth/2fa/setup` answers `{ secret, provisioningUri }` — the `otpauth://` URI an
 * authenticator app encodes as a QR, **not a rendered QR image**. So the screen offers the two
 * things that work from that: a one-tap handoff to the app that already understands the scheme,
 * and the base32 secret for typing in by hand. Neither asks the reader to photograph anything.
 *
 * The secret and the recovery codes are shown exactly once. The copy says so before they are
 * revealed, not after they are gone.
 *
 * ### The six D-5 states
 * - **default** — the start control.
 * - **loading** — the busy buttons on each step.
 * - **empty** — not applicable; the panel is never a list.
 * - **error** — `TWOFA_ALREADY_ENABLED` and `TWOFA_INVALID`, each with what to do next.
 * - **permission denied** — a suspended account renders the S-9 shell.
 * - **success** — the recovery codes, then the confirmation.
 */
export interface TwoFactorEnrolmentProps {
  /** Rendered under the success confirmation — "go to the console", "back to your account". */
  completionAction?: ReactNode;
  /** Admin accounts cannot skip this (S-8); the copy says so rather than offering a way out. */
  required?: boolean;
}

/** Base32 in groups of four: a secret typed from a screen is read four characters at a time. */
function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? [secret]).join(' ');
}

export function TwoFactorEnrolment({
  completionAction,
  required = false,
}: TwoFactorEnrolmentProps) {
  const t = useTranslations('account.twoFactor');
  const tc = useTranslations('auth.common');
  const copy = useErrorCopy();

  const setup = useTwoFactorSetup();
  const enable = useTwoFactorEnable();

  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);

  const enrolment = setup.data;
  const enabled = enable.data;

  if (enabled) {
    return (
      <FormSuccessFeedback
        title={t('enabledTitle')}
        description={t('enabledBody')}
        action={completionAction}
      >
        <Card className="w-full text-start">
          <CardHeader>
            <CardTitle as="h3" className="flex items-center gap-2 text-base">
              <KeyRound aria-hidden="true" className="size-4" />
              {t('recoveryTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">{t('recoveryBody')}</p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
              {enabled.recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode} className="rounded-md bg-surface-sunken px-3 py-2">
                  {recoveryCode}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </FormSuccessFeedback>
    );
  }

  if (!enrolment) {
    return (
      <div className="flex flex-col gap-4">
        {setup.error ? (
          <FormErrorFeedback
            error={setup.error}
            onRetry={
              setup.error.isRetryable
                ? () => {
                    setup.reset();
                  }
                : undefined
            }
          />
        ) : null}

        <p className="text-sm text-ink-muted">{required ? t('requiredBody') : t('optionalBody')}</p>

        <Button
          variant="primary"
          startIcon={<ShieldCheck aria-hidden="true" className="size-4" />}
          loading={setup.isPending}
          loadingLabel={tc('starting')}
          onClick={() => {
            if (setup.isPending) return;
            setup.mutate();
          }}
        >
          {t('startAction')}
        </Button>
      </div>
    );
  }

  const codeError =
    (enable.error ? copy.fieldMessage(enable.error, 'code') : undefined) ??
    (touched && !isOtpComplete(code) ? tc('fieldErrors.otp') : undefined);

  function confirmCode(value: string) {
    setTouched(true);
    if (enable.isPending || !isOtpComplete(value)) return;
    enable.mutate({ code: value });
  }

  return (
    <div className="flex flex-col gap-5">
      {enable.error ? (
        <FormErrorFeedback
          error={enable.error}
          onRetry={
            enable.error.isRetryable
              ? () => {
                  enable.reset();
                }
              : undefined
          }
        />
      ) : null}

      <Callout tone="warning" title={t('onceTitle')}>
        {t('onceBody')}
      </Callout>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">{t('step1Title')}</p>
        <p className="text-sm text-ink-muted">{t('step1Body')}</p>
        <Button asChild variant="secondary">
          {/* `otpauth://` is handled by the authenticator app itself — this is the same payload a
              QR would carry, without asking the reader to point one screen at another. */}
          <a href={enrolment.provisioningUri} rel="nofollow">
            {t('openInApp')}
          </a>
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">{t('step2Title')}</p>
        <p className="text-sm text-ink-muted">{t('step2Body')}</p>
        <p className="select-all rounded-md bg-surface-sunken px-3 py-3 font-mono text-sm tracking-wide">
          {groupSecret(enrolment.secret)}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ink">{t('step3Title')}</p>
        <OtpField
          label={t('codeLabel')}
          value={code}
          onValueChange={setCode}
          onComplete={confirmCode}
          hint={t('codeHint')}
          disabled={enable.isPending}
          error={codeError}
        />
      </div>

      <Button
        variant="primary"
        loading={enable.isPending}
        loadingLabel={tc('turningOn')}
        onClick={() => {
          confirmCode(code);
        }}
      >
        {t('confirmAction')}
      </Button>
    </div>
  );
}
