'use client';

import * as React from 'react';

import { Eye, EyeOff } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Input, type InputProps } from '../input/Input';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface PasswordStrength {
  /** 0–4. */
  score: 0 | 1 | 2 | 3 | 4;
  /** What would make it stronger. Advice, never a scolding (D-7). */
  hint?: string;
}

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'endAdornment'> {
  showLabel?: string;
  hideLabel?: string;
  /**
   * Strength result. Scoring is policy, and policy lives with the auth feature — this component
   * draws the meter, it does not decide what counts as strong.
   */
  strength?: PasswordStrength;
  /** Labels for the four bands, translated by the caller. */
  strengthLabels?: readonly [string, string, string, string, string];
}

const bandTone = [
  'bg-danger',
  'bg-danger',
  'bg-warning',
  'bg-success',
  'bg-success',
] as const;

/**
 * A password field with a reveal toggle and an optional strength meter.
 *
 * The toggle is a real button with a changing accessible name, not an icon that silently flips
 * state — a screen-reader user has to be told whether the password is currently visible.
 *
 * The meter reports a band and advice; it never blocks submission on its own.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      className,
      showLabel = 'Show password',
      hideLabel = 'Hide password',
      strength,
      strengthLabels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'],
      ...props
    },
    ref,
  ) {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className={cn('flex w-full flex-col gap-2', className)}>
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          autoComplete="current-password"
          endAdornment={
            <button
              type="button"
              onClick={() => setVisible((current) => !current)}
              aria-pressed={visible}
              className={cn(
                'pointer-events-auto inline-flex size-8 items-center justify-center rounded-sm',
                'touch-target-pseudo text-ink-subtle transition-colors hover:text-ink',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              )}
            >
              {visible ? (
                <EyeOff aria-hidden="true" className="size-4" />
              ) : (
                <Eye aria-hidden="true" className="size-4" />
              )}
              <VisuallyHidden>{visible ? hideLabel : showLabel}</VisuallyHidden>
            </button>
          }
          {...props}
        />

        {strength ? (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((band) => (
                <span
                  key={band}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors duration-base',
                    band < strength.score ? bandTone[strength.score] : 'bg-surface-sunken',
                  )}
                />
              ))}
            </div>
            <p className="text-xs text-ink-muted" aria-live="polite">
              {strengthLabels[strength.score]}
              {strength.hint ? ` — ${strength.hint}` : ''}
            </p>
          </div>
        ) : null}
      </div>
    );
  },
);
