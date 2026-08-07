'use client';

import * as React from 'react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface OtpInputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Number of digits. */
  length?: number;
  /** Fires once the full code is entered, so the form can submit without a second press. */
  onComplete?: (value: string) => void;
  /** Accessible name, e.g. "Verification code". Required. */
  label: string;
  /** Hint under the boxes: where the code was sent, how long it lasts. */
  hint?: React.ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * The email/SMS verification code field.
 *
 * One real `<input>` behind a row of boxes rather than N inputs: it gets `autocomplete="one-time-code"`
 * so iOS and Android offer the code from the message, it pastes correctly, and a screen reader
 * announces one field instead of six. The boxes are decoration painted over it.
 *
 * `inputMode="numeric"` brings up the number pad; numerals stay Latin in both locales (§6.7).
 */
export function OtpInput({
  value,
  onValueChange,
  length = 6,
  onComplete,
  label,
  hint,
  disabled = false,
  autoFocus = false,
  id,
  className,
  ...aria
}: OtpInputProps): React.JSX.Element {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [focused, setFocused] = React.useState(false);

  const digits = value.padEnd(length, ' ').slice(0, length).split('');
  const cursor = Math.min(value.length, length - 1);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* A <label> rather than a click handler: pressing any box focuses the real input via the
          platform, with no JS and no non-interactive element pretending to be a control. */}
      <label htmlFor={controlId} className="relative flex gap-2">
        <input
          ref={inputRef}
          id={controlId}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          value={value}
          disabled={disabled}
          /* eslint-disable-next-line jsx-a11y/no-autofocus --
             The rule's objection is autofocus that steals focus from other content. This field
             is opt-in (`autoFocus` defaults to false) and is only turned on by the phone-OTP
             and verify-email screens, where the code box is the entire purpose of the page and
             the user has just been told to type a code. Not focusing it there costs a
             screen-reader and switch user an extra traverse for nothing. */
          autoFocus={autoFocus}
          aria-label={label}
          aria-invalid={aria['aria-invalid']}
          aria-describedby={aria['aria-describedby']}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const next = event.target.value.replace(/\D/g, '').slice(0, length);
            onValueChange(next);
            if (next.length === length) onComplete?.(next);
          }}
          // Transparent, full-bleed, and still focusable: the caret lives in a real input.
          className="absolute inset-0 z-10 w-full cursor-default opacity-0"
        />

        {digits.map((digit, index) => (
          <span
            /* eslint-disable-next-line react/no-array-index-key --
               The index *is* the identity here: box 3 of 6 is box 3 of 6 for the life of the
               component. The list is fixed-length and never reordered, inserted into or
               filtered, which is the reordering hazard the rule exists to catch. */
            key={index}
            aria-hidden="true"
            className={cn(
              'flex h-14 w-11 items-center justify-center rounded-md border font-mono text-xl tabular-nums',
              'transition-[border-color,box-shadow] duration-fast ease-out',
              digit.trim() ? 'border-line-strong bg-surface text-ink' : 'border-line bg-surface-sunken',
              focused && index === cursor && 'border-brand shadow-[var(--shadow-focus)]',
              disabled && 'opacity-50',
            )}
          >
            {digit.trim()}
          </span>
        ))}
      </label>

      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      <VisuallyHidden aria-live="polite">
        {value.length === length ? `${String(length)} of ${String(length)} digits entered` : ''}
      </VisuallyHidden>
    </div>
  );
}
