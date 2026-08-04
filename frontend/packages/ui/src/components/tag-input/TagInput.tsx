'use client';

import * as React from 'react';

import { X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface TagInputProps {
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  /** Accessible name. Required unless it sits inside a `FormField`. */
  label?: string;
  /** Keys that commit the current text. Comma is included because people paste comma lists. */
  commitKeys?: readonly string[];
  /** Reject a tag before it is added — return an error string, or null to accept. */
  validate?: (tag: string) => string | null;
  maxTags?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  removeLabel?: (tag: string) => string;
  /** Live message when a tag is rejected. States what to do next (D-7). */
  onError?: (message: string) => void;
}

/**
 * Free-text tags: garment keywords, admin note labels.
 *
 * Enter or comma commits, Backspace on an empty field removes the last tag, and every tag has
 * its own remove button that is a real 44px target — a chip whose only affordance is a 10px
 * cross is unusable with a thumb (D-10).
 *
 * Duplicates are ignored silently rather than reported: the user's intent is already satisfied.
 */
export function TagInput({
  value,
  onValueChange,
  placeholder = 'Add a tag',
  label,
  commitKeys = ['Enter', ','],
  validate,
  maxTags,
  disabled = false,
  id,
  className,
  removeLabel = (tag) => `Remove ${tag}`,
  onError,
}: TagInputProps): React.JSX.Element {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const [draft, setDraft] = React.useState('');

  const commit = (): void => {
    const tag = draft.trim();
    if (tag === '') return;
    if (maxTags !== undefined && value.length >= maxTags) return;
    if (value.includes(tag)) {
      setDraft('');
      return;
    }

    const error = validate?.(tag) ?? null;
    if (error) {
      onError?.(error);
      return;
    }

    onValueChange([...value, tag]);
    setDraft('');
  };

  return (
    <div
      className={cn(
        'flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1.5',
        'transition-[border-color,box-shadow] duration-fast ease-out',
        'focus-within:border-brand focus-within:shadow-[var(--shadow-focus)]',
        disabled && 'cursor-not-allowed bg-surface-sunken opacity-70',
        className,
      )}
    >
      <ul className="contents">
        {value.map((tag) => (
          <li
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-surface-sunken py-0.5 ps-2.5 pe-0.5 text-xs text-ink"
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onValueChange(value.filter((item) => item !== tag))}
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-full text-ink-subtle',
                'touch-target-pseudo transition-colors hover:text-danger',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              )}
            >
              <X aria-hidden="true" className="size-3" />
              <VisuallyHidden>{removeLabel(tag)}</VisuallyHidden>
            </button>
          </li>
        ))}
      </ul>

      <input
        id={controlId}
        type="text"
        value={draft}
        disabled={disabled || (maxTags !== undefined && value.length >= maxTags)}
        aria-label={label}
        placeholder={value.length === 0 ? placeholder : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (commitKeys.includes(event.key)) {
            event.preventDefault();
            commit();
          } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
            onValueChange(value.slice(0, -1));
          }
        }}
        className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm text-ink outline-none placeholder:text-ink-subtle"
      />
    </div>
  );
}
