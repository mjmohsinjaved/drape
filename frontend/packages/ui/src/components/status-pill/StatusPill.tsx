import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export const statusPillVariants = cva(
  [
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full',
    'font-body font-semibold',
    'border',
  ],
  {
    variants: {
      tone: {
        neutral: 'border-line-strong bg-surface-sunken text-ink-muted',
        info: 'border-info/30 bg-info-tint text-info',
        success: 'border-success/30 bg-success-tint text-success',
        warning: 'border-warning/30 bg-warning-tint text-warning',
        danger: 'border-danger/30 bg-danger-tint text-danger',
        brand: 'border-brand/30 bg-brand-tint text-brand',
      },
      size: {
        sm: 'px-2 py-0.5 text-2xs',
        md: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

const dotVariants = cva('size-1.5 shrink-0 rounded-full bg-current', {
  variants: {
    pulse: {
      /* Motion is purposeful: only a genuinely in-flight state pulses (D-11). */
      true: 'animate-pulse',
      false: '',
    },
  },
  defaultVariants: { pulse: false },
});

export interface StatusPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusPillVariants> {
  /** The visible status word. Keep it the same word the action used (D-13): Publish -> Published. */
  children: React.ReactNode;
  /**
   * Prefix read to assistive tech, e.g. "Status:". Colour is never the only signal (D-20) — the
   * word carries the meaning and this names what the word is about.
   */
  srPrefix?: string;
  /** Show the leading dot. */
  dot?: boolean;
  /** Pulse the dot for a state that is actively changing (a render in flight). */
  pulse?: boolean;
  /** Announce changes politely — for a pill that updates in place while the user watches. */
  live?: boolean;
}

/**
 * Lifecycle state: draft/published, pending/approved, queued/processing/ready/failed.
 *
 * Distinct from `Badge` because status is semantic — it gets a `srPrefix`, an optional live
 * region, and a dot so it is legible without relying on hue.
 */
export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(function StatusPill(
  { className, tone, size, children, srPrefix = 'Status', dot = true, pulse, live, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(statusPillVariants({ tone, size }), className)}
      {...(live ? { role: 'status', 'aria-live': 'polite' } : {})}
      {...props}
    >
      {dot ? <span aria-hidden="true" className={dotVariants({ pulse: pulse ?? false })} /> : null}
      {srPrefix ? <VisuallyHidden>{`${srPrefix}: `}</VisuallyHidden> : null}
      {children}
    </span>
  );
});
