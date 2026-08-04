'use client';

import * as React from 'react';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';

import { cn } from '../../lib/cn';

export type CompareView = 'catalog' | 'tryon';

export interface CompareToggleProps
  extends Omit<React.ComponentPropsWithoutRef<'div'>, 'onChange'> {
  value: CompareView;
  onValueChange: (value: CompareView) => void;
  /** Label for the catalog photo. Default reads as the source, not as "the real one". */
  catalogLabel?: string;
  /**
   * Label for the render. "Your try-on" — never "Your look", never "You in this".
   * A try-on is an indicative try-on (PRD §9.4, §8.3 checks 2 and 3).
   */
  tryonLabel?: string;
  /** Accessible name for the group. */
  label?: string;
  size?: 'sm' | 'md';
}

/**
 * The catalog-photo ↔ try-on switch that sits beside the result (C-20).
 *
 * It is a two-option toggle group rather than a slider or a hover swap, so it is operable by
 * keyboard and by thumb, and so the current view is announced rather than merely visible.
 *
 * The default labels are written to the copy check: the render is "Your try-on", the source is
 * "Catalog photo". Neither promises accuracy, and neither says "see yourself in".
 */
export const CompareToggle = React.forwardRef<HTMLDivElement, CompareToggleProps>(
  function CompareToggle(
    {
      className,
      value,
      onValueChange,
      catalogLabel = 'Catalog photo',
      tryonLabel = 'Your try-on',
      label = 'Choose which image to show',
      size = 'md',
      ...props
    },
    ref,
  ) {
    return (
      <div ref={ref} className={className} {...props}>
        <ToggleGroupPrimitive.Root
          type="single"
          value={value}
          aria-label={label}
          onValueChange={(next) => {
            // Radix emits '' when a user re-presses the active item; a comparison must always
            // have something on screen, so an empty selection is ignored.
            if (next === 'catalog' || next === 'tryon') onValueChange(next);
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-full bg-surface-sunken p-1',
            size === 'sm' ? 'text-xs' : 'text-sm',
          )}
        >
          {(
            [
              ['catalog', catalogLabel],
              ['tryon', tryonLabel],
            ] as const
          ).map(([key, text]) => (
            <ToggleGroupPrimitive.Item
              key={key}
              value={key}
              className={cn(
                'inline-flex items-center justify-center rounded-full px-4 font-medium whitespace-nowrap',
                'transition-[background-color,color] duration-fast ease-out',
                size === 'sm' ? 'min-h-9' : 'min-h-11',
                'text-ink-muted hover:text-ink',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
                'data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-xs',
              )}
            >
              {text}
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
      </div>
    );
  },
);
