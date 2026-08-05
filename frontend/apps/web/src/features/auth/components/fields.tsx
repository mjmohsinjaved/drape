'use client';

import { useId, type ReactNode } from 'react';

import { AlertCircle, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Input, Label, OtpInput, PasswordInput } from '@repo/ui';

import {
  MAX_PASSWORD_LENGTH,
  OTP_LENGTH,
  checkPasswordRules,
  passwordStrength,
} from '@/features/auth/lib/password-policy';

/**
 * The three field shapes every auth and account form is built from.
 *
 * Each one owns its own ids so the label, the hint, the requirement list and the error message
 * are wired to the control with `htmlFor`, `aria-describedby` and `aria-invalid` without the
 * call site having to remember. Controls are 44 px tall by default (D-10) and every layout
 * value is logical, so they mirror under `ur` with no per-side override (§6.7).
 */

interface FieldFrameProps {
  controlId: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  hintId: string;
  error?: string;
  errorId: string;
  children: ReactNode;
}

function FieldFrame({
  controlId,
  label,
  required = false,
  hint,
  hintId,
  error,
  errorId,
  children,
}: FieldFrameProps) {
  const t = useTranslations('auth.common');

  return (
    <div className="flex w-full flex-col gap-1.5">
      <Label htmlFor={controlId} required={required} requiredLabel={t('required')}>
        {label}
      </Label>
      {children}
      {hint ? (
        <div id={hintId} className="text-xs text-ink-muted">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="flex items-start gap-1.5 text-xs font-medium text-danger"
        >
          <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

function describedBy(hintId: string, hasHint: boolean, errorId: string, hasError: boolean) {
  const ids = [hasHint ? hintId : null, hasError ? errorId : null].filter(
    (id): id is string => id !== null,
  );
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export interface TextFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'date';
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'tel';
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  /** `YYYY-MM-DD` floor for a date field — an event that already happened is not a plan. */
  min?: string;
  /** Only the first field of a screen whose whole purpose is that field should set this. */
  autoFocus?: boolean;
}

export function TextField({
  label,
  value,
  onValueChange,
  type = 'text',
  autoComplete,
  inputMode,
  placeholder,
  hint,
  error,
  required = false,
  disabled = false,
  maxLength,
  min,
  autoFocus = false,
}: TextFieldProps) {
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  return (
    <FieldFrame
      controlId={controlId}
      label={label}
      required={required}
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <Input
        id={controlId}
        type={type}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        min={min}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, Boolean(hint), errorId, Boolean(error))}
        // Opt-in, and only set where the field *is* the page — the recovery-code screen. Not
        // focusing there costs a screen-reader or switch user an extra traverse to reach the
        // one control the screen exists for.
        autoFocus={autoFocus}
      />
    </FieldFrame>
  );
}

export interface PasswordFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string;
  disabled?: boolean;
  /**
   * Shows the S-6 requirements and the strength band. Turned on for every field that *sets* a
   * password, so the rules are visible before submission rather than reported after failure.
   */
  showPolicy?: boolean;
  hint?: ReactNode;
}

export function PasswordField({
  label,
  value,
  onValueChange,
  autoComplete,
  error,
  disabled = false,
  showPolicy = false,
  hint,
}: PasswordFieldProps) {
  const t = useTranslations('auth.common');
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  const rules = checkPasswordRules(value);
  const policyHint = showPolicy ? (
    <>
      <p className="font-medium text-ink">{t('passwordRules.title')}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {(['length', 'number', 'symbol'] as const).map((rule) => (
          <li key={rule} className="flex items-center gap-1.5">
            <Check
              aria-hidden="true"
              className={
                rules[rule] ? 'size-3.5 shrink-0 text-success' : 'size-3.5 shrink-0 text-ink-subtle'
              }
            />
            <span className={rules[rule] ? 'text-ink' : undefined}>
              {t(`passwordRules.${rule}`)}
            </span>
            <span className="sr-only">
              {rules[rule] ? t('passwordRules.met') : t('passwordRules.notMet')}
            </span>
          </li>
        ))}
      </ul>
    </>
  ) : (
    hint
  );

  const strengthLabels = [
    t('strength.veryWeak'),
    t('strength.weak'),
    t('strength.fair'),
    t('strength.strong'),
    t('strength.veryStrong'),
  ] as const;

  return (
    <FieldFrame
      controlId={controlId}
      label={label}
      required
      hint={policyHint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <PasswordInput
        id={controlId}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        autoComplete={autoComplete}
        disabled={disabled}
        required
        maxLength={MAX_PASSWORD_LENGTH}
        showLabel={t('showPassword')}
        hideLabel={t('hidePassword')}
        strengthLabels={strengthLabels}
        strength={showPolicy && value.length > 0 ? { score: passwordStrength(value) } : undefined}
        aria-required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, Boolean(policyHint), errorId, Boolean(error))}
      />
    </FieldFrame>
  );
}

export interface OtpFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onComplete?: (value: string) => void;
  hint?: ReactNode;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** The six-digit code field, for the 2FA challenge, 2FA enrolment and the phone OTP (C-3, S-8). */
export function OtpField({
  label,
  value,
  onValueChange,
  onComplete,
  hint,
  error,
  disabled = false,
  autoFocus = false,
}: OtpFieldProps) {
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  return (
    <FieldFrame
      controlId={controlId}
      label={label}
      required
      hint={hint}
      hintId={hintId}
      error={error}
      errorId={errorId}
    >
      <OtpInput
        id={controlId}
        label={label}
        value={value}
        onValueChange={onValueChange}
        onComplete={onComplete}
        length={OTP_LENGTH}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hintId, Boolean(hint), errorId, Boolean(error))}
      />
    </FieldFrame>
  );
}
