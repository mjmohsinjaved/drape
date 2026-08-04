'use client';

import * as React from 'react';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';

import { cn } from '../../lib/cn';

export type RadioGroupProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>;

/**
 * Radix reads direction from `<DirectionProvider>`, so arrow keys follow the reading order in
 * both locales without a single side-specific line here.
 */
export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupProps
>(function RadioGroup({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Root ref={ref} className={cn('flex flex-col gap-3', className)} {...props} />
  );
});

export type RadioGroupItemProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>;

export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        'relative inline-flex size-5 shrink-0 items-center justify-center rounded-full',
        'border border-line-strong bg-surface',
        'transition-[border-color,box-shadow] duration-fast ease-out',
        'touch-target-pseudo',
        'hover:border-brand',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        'data-[state=checked]:border-brand',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-brand" />
    </RadioGroupPrimitive.Item>
  );
});

export interface RadioGroupOptionProps extends RadioGroupItemProps {
  /** The clickable label. Required. */
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Draw the option as a selectable card — for a small set of weighted choices. */
  card?: boolean;
}

export const RadioGroupOption = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupOptionProps
>(function RadioGroupOption({ label, description, card = false, className, id, ...props }, ref) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;

  return (
    <div
      className={cn(
        'flex items-start gap-3',
        card &&
          'rounded-lg border border-line bg-surface p-4 transition-colors duration-fast hover:border-line-strong has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-tint',
        className,
      )}
    >
      <RadioGroupItem
        ref={ref}
        id={controlId}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-0.5"
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={controlId} className="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-xs text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
});
