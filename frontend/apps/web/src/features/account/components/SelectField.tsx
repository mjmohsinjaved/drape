'use client';

import { useId } from 'react';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  /** The empty string means "not answered". Every C-2 field may legitimately be blank. */
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder: string;
  /** Rendered as "(optional)" on the label, which is kinder than marking the required ones. */
  optional?: boolean;
  hint?: string;
  error?: string;
  disabled?: boolean;
}

/**
 * A labelled select, wired the same way as the auth fields: one id shared by the label and the
 * trigger, `aria-describedby` listing only the descriptions actually on screen, `aria-invalid`
 * when there is an error.
 *
 * The trigger is 44 px tall by default (D-10) and every spacing value is logical (§6.7).
 */
export function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  optional = false,
  hint,
  error,
  disabled = false,
}: SelectFieldProps) {
  const t = useTranslations('auth.common');
  const base = useId();
  const controlId = `${base}-control`;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter((id): id is string => id !== null)
    .join(' ');

  return (
    <div className="flex w-full flex-col gap-1.5">
      <Label htmlFor={controlId} optional={optional} optionalLabel={t('optional')}>
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={controlId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
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
