'use client';

import * as React from 'react';

import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '../../lib/cn';

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

/**
 * A switch takes effect immediately. If the change needs a Save press, it is a `Checkbox`.
 *
 * The thumb translates with a logical `translate-x` under Radix's direction context, so the
 * "on" position is on the reading-end side in both locales.
 */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5',
        'border border-transparent bg-line-strong',
        'transition-[background-color,box-shadow] duration-fast ease-out',
        'touch-target-pseudo',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        'data-[state=checked]:bg-brand',
        'disabled:cursor-not-allowed disabled:opacity-50',
        /* The thumb is positioned with flex justification, not a translate.
           `justify-end` follows the reading direction, so "on" lands on the
           correct side in `ur` without a transform this codebase would then
           have to mirror (§6.7). */
        'justify-start data-[state=checked]:justify-end',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-5 rounded-full bg-surface shadow-sm',
          'transition-[translate] duration-fast ease-out',
        )}
      />
    </SwitchPrimitive.Root>
  );
});

export interface SwitchFieldProps extends SwitchProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
}

/**
 * Switch plus label, label first. The control sits on the reading-end side because the label is
 * what the user scans; `justify-between` places it there in both directions.
 */
export const SwitchField = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchFieldProps
>(function SwitchField({ label, description, id, className, ...props }, ref) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;

  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
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
      <Switch
        ref={ref}
        id={controlId}
        aria-describedby={description ? descriptionId : undefined}
        {...props}
      />
    </div>
  );
});
