'use client';

import * as React from 'react';

import { Check, ChevronDown, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Badge } from '../badge/Badge';
import { Popover, PopoverAnchor, PopoverContent } from '../popover/Popover';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

import type { ComboboxOption } from '../combobox/Combobox';

export type MultiSelectOption = ComboboxOption;

export interface MultiSelectProps {
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  /** Accessible name for the control. Required unless it sits in a `FormField`. */
  label?: string;
  emptyMessage?: React.ReactNode;
  /** Collapse the chips past this many and show "+N more". */
  maxVisibleChips?: number;
  removeLabel?: (option: MultiSelectOption) => string;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/**
 * Several values from a fixed list: garment categories, admin filters, notification channels.
 *
 * Selected values are chips inside the control, each individually removable — so a user can undo
 * one choice without reopening the list. Backspace on the empty field removes the last chip, the
 * behaviour every tag control has trained people to expect.
 */
export function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder = 'Select',
  label,
  emptyMessage = 'Nothing left to choose here.',
  maxVisibleChips = 3,
  removeLabel = (option) => `Remove ${option.label}`,
  disabled = false,
  id,
  className,
  ...aria
}: MultiSelectProps): React.JSX.Element {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const listboxId = `${controlId}-listbox`;
  const [open, setOpen] = React.useState(false);

  const selected = options.filter((option) => value.includes(option.value));
  const overflow = Math.max(selected.length - maxVisibleChips, 0);

  const toggle = (option: MultiSelectOption): void => {
    if (option.disabled) return;
    onValueChange(
      value.includes(option.value)
        ? value.filter((item) => item !== option.value)
        : [...value, option.value],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        {/* The chips are siblings of the trigger, never children of it: a remove button nested
            inside the combobox button would be a control inside a control, which is invalid and
            unreachable for a keyboard user. */}
        <div
          className={cn(
            'flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-2',
            'transition-[border-color,box-shadow] duration-fast ease-out',
            'hover:border-ink-subtle',
            'focus-within:border-brand focus-within:shadow-[var(--shadow-focus)]',
            disabled && 'cursor-not-allowed bg-surface-sunken opacity-70',
            aria['aria-invalid'] && 'border-danger',
            className,
          )}
        >
          {selected.slice(0, maxVisibleChips).map((option) => (
            <Badge key={option.value} variant="neutral" size="md" className="gap-1 pe-1">
              {option.label}
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(option)}
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-full text-ink-subtle',
                  'touch-target-pseudo transition-colors hover:text-danger',
                  'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
                )}
              >
                <X aria-hidden="true" className="size-3" />
                <VisuallyHidden>{removeLabel(option)}</VisuallyHidden>
              </button>
            </Badge>
          ))}
          {overflow > 0 ? <Badge variant="outline">{`+${String(overflow)}`}</Badge> : null}

          <button
            type="button"
            id={controlId}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-haspopup="listbox"
            aria-label={label}
            aria-describedby={aria['aria-describedby']}
            aria-invalid={aria['aria-invalid']}
            disabled={disabled}
            onClick={() => setOpen((current) => !current)}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && selected.length > 0 && !open) {
                event.preventDefault();
                onValueChange(value.slice(0, -1));
              }
            }}
            className={cn(
              'flex min-h-7 flex-1 items-center gap-2 rounded-sm text-start',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              'disabled:cursor-not-allowed',
            )}
          >
            {selected.length === 0 ? (
              <span className="text-base text-ink-subtle">{placeholder}</span>
            ) : null}
            <ChevronDown aria-hidden="true" className="ms-auto size-4 shrink-0 text-ink-subtle" />
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent align="start" sideOffset={4} className="w-[var(--radix-popover-trigger-width)] p-1">
        {options.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">{emptyMessage}</p>
        ) : (
          <ul id={listboxId} role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto">
            {options.map((option) => {
              const checked = value.includes(option.value);
              return (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={option.disabled}
                  tabIndex={0}
                  onClick={() => toggle(option)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle(option);
                    }
                  }}
                  className={cn(
                    'flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm',
                    'hover:bg-surface-sunken',
                    'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
                    checked && 'text-brand',
                    option.disabled && 'pointer-events-none opacity-50',
                  )}
                >
                  <Check
                    aria-hidden="true"
                    className={cn('size-4 shrink-0', checked ? '' : 'invisible')}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.description ? (
                      <span className="truncate text-xs text-ink-subtle">{option.description}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
