'use client';

import * as React from 'react';

import { Calendar } from 'lucide-react';

import { cn } from '../../lib/cn';

export interface DatePickerProps
  // `size` is omitted too: on a native input it is a character-width number,
  // whereas here it selects the visual scale.
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'size'
  > {
  /** ISO `YYYY-MM-DD`, or empty. */
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name. Required unless it sits inside a `FormField`. */
  label?: string;
  /** ISO `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  size?: 'md' | 'sm' | 'density';
}

/**
 * Date entry for admin filters and enquiry follow-ups.
 *
 * Deliberately the platform control (`<input type="date">`) rather than a hand-built calendar:
 * it is already localised, already keyboard-operable, already announced correctly, already
 * mirrors under RTL, and on Android it opens the picker people already know. A custom calendar
 * would be a second implementation of all of that, and every one of them regresses somewhere.
 *
 * The value is ISO because that is what the API takes. Display formatting elsewhere goes through
 * `formatDate` in `@repo/utils` with the active locale and `Asia/Karachi` (§6.7).
 */
export const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker(
  { className, value, onValueChange, label, min, max, size = 'md', disabled, ...props },
  ref,
) {
  return (
    <div className="relative flex w-full items-center">
      <input
        ref={ref}
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'flex w-full min-w-0 border border-line-strong bg-surface font-body text-ink',
          'transition-[border-color,box-shadow] duration-fast ease-out',
          'hover:border-ink-subtle',
          'focus-visible:border-brand focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-subtle',
          'aria-[invalid=true]:border-danger',
          // The native indicator is inconsistent across browsers; ours sits in the flow instead.
          '[&::-webkit-calendar-picker-indicator]:opacity-0',
          size === 'md' && 'h-11 rounded-md px-3 pe-10 text-base',
          size === 'sm' && 'h-9 rounded-sm px-2.5 pe-9 text-sm',
          size === 'density' && 'min-h-control rounded-sm px-2.5 pe-9 text-density',
          className,
        )}
        {...props}
      />
      <Calendar aria-hidden="true" className="pointer-events-none absolute end-3 size-4 text-ink-subtle" />
    </div>
  );
});
