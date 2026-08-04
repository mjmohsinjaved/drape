'use client';

import * as React from 'react';

import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

const labelVariants = cva('inline-flex items-center gap-1 font-body font-medium text-ink', {
  variants: {
    size: {
      sm: 'text-xs',
      md: 'text-sm',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface LabelProps
  extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
    VariantProps<typeof labelVariants> {
  /** Renders the required marker and the word "required" for assistive tech. */
  required?: boolean;
  /** Marker text. Translate it — an asterisk alone is not a label in every locale. */
  requiredLabel?: string;
  /** Renders "(optional)" instead. Marking the optional fields is often kinder than marking the required ones. */
  optional?: boolean;
  optionalLabel?: string;
}

export const Label = React.forwardRef<React.ComponentRef<typeof LabelPrimitive.Root>, LabelProps>(
  function Label(
    {
      className,
      size,
      required = false,
      requiredLabel = 'required',
      optional = false,
      optionalLabel = 'optional',
      children,
      ...props
    },
    ref,
  ) {
    return (
      <LabelPrimitive.Root ref={ref} className={cn(labelVariants({ size }), className)} {...props}>
        {children}
        {required ? (
          <>
            <span aria-hidden="true" className="text-danger">
              *
            </span>
            <VisuallyHidden>{` (${requiredLabel})`}</VisuallyHidden>
          </>
        ) : null}
        {optional && !required ? (
          <span className="font-normal text-ink-subtle">{`(${optionalLabel})`}</span>
        ) : null}
      </LabelPrimitive.Root>
    );
  },
);
