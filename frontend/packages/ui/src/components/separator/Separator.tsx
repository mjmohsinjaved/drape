'use client';

import * as React from 'react';

import * as SeparatorPrimitive from '@radix-ui/react-separator';

import { cn } from '../../lib/cn';

export interface SeparatorProps
  extends React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  /** `strong` uses --color-line-strong for a divider that must read, e.g. between form sections. */
  weight?: 'hairline' | 'strong';
  /** Optional centred label, e.g. "or". Forces `decorative` off so the label is announced. */
  label?: React.ReactNode;
}

/**
 * Decorative by default: a rule that only groups things visually should not be announced.
 * Pass `decorative={false}` when the rule genuinely separates two sections of content.
 */
export const Separator = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  SeparatorProps
>(function Separator(
  { className, orientation = 'horizontal', decorative = true, weight = 'hairline', label, ...props },
  ref,
) {
  const line = weight === 'strong' ? 'bg-line-strong' : 'bg-line';

  if (label && orientation === 'horizontal') {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <SeparatorPrimitive.Root
          ref={ref}
          decorative
          orientation="horizontal"
          className={cn('h-px flex-1', line)}
          {...props}
        />
        <span className="text-xs text-ink-subtle">{label}</span>
        <SeparatorPrimitive.Root decorative orientation="horizontal" className={cn('h-px flex-1', line)} />
      </div>
    );
  }

  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0',
        line,
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
});
