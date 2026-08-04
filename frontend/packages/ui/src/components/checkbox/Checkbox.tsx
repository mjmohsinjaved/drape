'use client';

import * as React from 'react';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '../../lib/cn';

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

/**
 * Never pre-checked on a consent surface. C-11 and PRD §10.3 are explicit: the consent gate has
 * no pre-checked boxes and no visual pressure toward acceptance.
 *
 * The 20px box sits inside a 44px hit area via `touch-target-pseudo` (D-10).
 */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer relative inline-flex size-5 shrink-0 items-center justify-center rounded-xs',
        'border border-line-strong bg-surface',
        'transition-[background-color,border-color,box-shadow] duration-fast ease-out',
        'touch-target-pseudo',
        'hover:border-brand',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-fg',
        'data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:text-brand-fg',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong',
        'aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? (
          <Minus aria-hidden="true" className="size-3.5" strokeWidth={3} />
        ) : (
          <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export interface CheckboxFieldProps extends CheckboxProps {
  /** The clickable label. Required — a checkbox with no label is unusable and untranslatable. */
  label: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  /** id shared by box and label. Generated when absent. */
  id?: string;
}

/**
 * Checkbox plus label plus optional description, laid out with logical spacing so the box sits
 * on the reading-start side in both locales.
 */
export const CheckboxField = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxFieldProps
>(function CheckboxField({ label, description, id, className, ...props }, ref) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Checkbox
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
