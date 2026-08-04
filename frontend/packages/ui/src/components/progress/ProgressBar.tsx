'use client';

import * as React from 'react';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';

const trackVariants = cva('relative w-full overflow-hidden rounded-full bg-surface-sunken', {
  variants: {
    size: {
      sm: 'h-1',
      md: 'h-2',
      lg: 'h-3',
    },
  },
  defaultVariants: { size: 'md' },
});

const fillVariants = cva('h-full transition-[inline-size] duration-base ease-out', {
  variants: {
    tone: {
      brand: 'bg-brand',
      success: 'bg-success',
      warning: 'bg-warning',
      danger: 'bg-danger',
      info: 'bg-info',
    },
  },
  defaultVariants: { tone: 'brand' },
});

export interface ProgressBarProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, 'value'>,
    VariantProps<typeof trackVariants>,
    VariantProps<typeof fillVariants> {
  /** 0–`max`. Pass `null` for indeterminate work whose end is unknown. */
  value: number | null;
  max?: number;
  /** Accessible name. Required — "Uploading kurta-front.jpg", not "Progress". */
  label: string;
  /** Show the label and the percentage above the track. */
  showLabel?: boolean;
  /** Overrides the announced value text: `(value, max) => '3 of 8 files'`. */
  formatValue?: (value: number, max: number) => string;
}

/**
 * Determinate progress for uploads (A-9), bulk operations (D-16) and quota meters.
 *
 * The fill grows with `inline-size`, not `width` + `transform`, so it starts from the
 * reading-start edge in both locales without a mirrored transform.
 */
export const ProgressBar = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  ProgressBarProps
>(function ProgressBar(
  { className, value, max = 100, label, showLabel = false, size, tone, formatValue, ...props },
  ref,
) {
  const clamped = value === null ? null : Math.min(Math.max(value, 0), max);
  const percent = clamped === null ? 0 : (clamped / max) * 100;
  const valueText =
    clamped === null
      ? undefined
      : formatValue
        ? formatValue(clamped, max)
        : `${String(Math.round(percent))}%`;

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {showLabel ? (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-muted">{label}</span>
          {valueText ? <span className="tabular-nums text-ink">{valueText}</span> : null}
        </div>
      ) : null}
      <ProgressPrimitive.Root
        ref={ref}
        value={clamped}
        max={max}
        aria-label={showLabel ? undefined : label}
        aria-valuetext={valueText}
        className={cn(trackVariants({ size }))}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(fillVariants({ tone }), clamped === null && 'skeleton-sheen w-1/3')}
          style={clamped === null ? undefined : { inlineSize: `${String(percent)}%` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
});

/** Alias: `Progress` reads better at a call site that is not about a bar. */
export const Progress = ProgressBar;
