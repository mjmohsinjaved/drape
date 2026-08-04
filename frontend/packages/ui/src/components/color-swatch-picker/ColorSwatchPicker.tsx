'use client';

import * as React from 'react';

import { Check } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface ColorSwatch {
  /** Stored value — a colour name or code from the catalog, not a CSS colour. */
  value: string;
  /** The human name: "Lac red", "Antique gold". This is what is announced and what is searched. */
  label: string;
  /** CSS colour used to paint the swatch. This is the one place a caller supplies a colour, and
   *  it is garment data from the API, not a design token — the D-1 ban is on design colours. */
  color: string;
  /** For a two-tone or shot fabric. */
  secondaryColor?: string;
  disabled?: boolean;
}

export interface ColorSwatchPickerProps {
  swatches: readonly ColorSwatch[];
  value?: string | null;
  onValueChange: (value: string) => void;
  /** Accessible name for the group. Required. */
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

/**
 * Colour choice for the catalog filter and the garment editor.
 *
 * A radiogroup, not a row of buttons: arrow keys move between swatches and only one is in the
 * tab order, which is what the pattern is for.
 *
 * Every swatch carries its name in text for assistive tech, and the selected one is marked with
 * a tick as well as a ring — a picker that signals selection with colour alone is unreadable to
 * the users most likely to need the names (D-20).
 */
export function ColorSwatchPicker({
  swatches,
  value = null,
  onValueChange,
  label,
  size = 'md',
  disabled = false,
  className,
}: ColorSwatchPickerProps): React.JSX.Element {
  const enabled = swatches.filter((swatch) => !swatch.disabled);

  const move = (delta: number): void => {
    if (enabled.length === 0) return;
    const currentIndex = enabled.findIndex((swatch) => swatch.value === value);
    const nextIndex = (currentIndex + delta + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (next) onValueChange(next.value);
  };

  return (
    /* eslint-disable-next-line jsx-a11y/interactive-supports-focus --
       The rule wants a `tabIndex` on any element carrying a key handler. That would be wrong
       here: this is the roving-tabindex pattern the WAI-ARIA radiogroup practice prescribes —
       exactly one swatch is in the tab order at a time (see `tabIndex` on the buttons below)
       and the arrow keys move both the selection and the focus. Making the container focusable
       would add a second, silent tab stop in front of every colour filter. */
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn('flex flex-wrap gap-2', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {swatches.map((swatch) => {
        const checked = swatch.value === value;
        return (
          <button
            key={swatch.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={swatch.label}
            disabled={disabled || swatch.disabled}
            tabIndex={checked || (!value && swatch === enabled[0]) ? 0 : -1}
            onClick={() => onValueChange(swatch.value)}
            className={cn(
              'relative inline-flex items-center justify-center rounded-full border-2',
              'touch-target-pseudo transition-[border-color,scale] duration-fast ease-out',
              'hover:scale-105',
              'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
              'disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'size-7' : 'size-9',
              checked ? 'border-brand' : 'border-line-strong',
            )}
          >
            <span
              aria-hidden="true"
              className="size-full rounded-full"
              style={
                swatch.secondaryColor
                  ? {
                      backgroundImage: `linear-gradient(135deg, ${swatch.color} 50%, ${swatch.secondaryColor} 50%)`,
                    }
                  : { backgroundColor: swatch.color }
              }
            />
            {checked ? (
              <Check
                aria-hidden="true"
                className="absolute size-4 text-canvas mix-blend-difference"
                strokeWidth={3}
              />
            ) : null}
            <VisuallyHidden>{swatch.label}</VisuallyHidden>
          </button>
        );
      })}
    </div>
  );
}
