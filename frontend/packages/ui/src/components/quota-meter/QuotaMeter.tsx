'use client';

import * as React from 'react';

import { cn } from '../../lib/cn';
import { ProgressBar } from '../progress/ProgressBar';

export interface QuotaMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  /** How many try-ons are left. Derived by the API from the append-only ledger, never stored. */
  remaining: number;
  /** The allowance for the period. */
  total: number;
  /**
   * The visible label. Name it by what the user controls, not by how the system is built:
   * "Try-ons left this month", never "Quota balance" (D-14).
   */
  label?: string;
  /** Renewal line, e.g. "Renews on 1 September". */
  hint?: React.ReactNode;
  /** What to do when nothing is left. Quota exhaustion is never a dead end (PRD §10.3). */
  exhaustedAction?: React.ReactNode;
  /** Copy shown at zero. States the position and the way forward, without apologising (D-7). */
  exhaustedMessage?: React.ReactNode;
  size?: 'sm' | 'md';
}

/**
 * The remaining-try-ons meter.
 *
 * The tone steps from brand to warning to danger as the allowance runs down, but the number is
 * always spelled out — colour is never the only signal (D-20).
 *
 * At zero it does not simply go red and stop: it shows the way on, which for Drape means the
 * shortlist and the enquiry action.
 */
export const QuotaMeter = React.forwardRef<HTMLDivElement, QuotaMeterProps>(function QuotaMeter(
  {
    className,
    remaining,
    total,
    label = 'Try-ons left this month',
    hint,
    exhaustedAction,
    exhaustedMessage = 'You have used every try-on in this month’s allowance. Your shortlist is still here, and you can send an enquiry about anything in it.',
    size = 'md',
    ...props
  },
  ref,
) {
  const safeTotal = Math.max(total, 1);
  const used = Math.max(safeTotal - Math.max(remaining, 0), 0);
  const exhausted = remaining <= 0;
  const low = !exhausted && remaining / safeTotal <= 0.25;

  return (
    <div ref={ref} className={cn('flex w-full flex-col gap-2', className)} {...props}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn('text-ink-muted', size === 'sm' ? 'text-xs' : 'text-sm')}>{label}</span>
        <span className={cn('font-semibold tabular-nums text-ink', size === 'sm' ? 'text-sm' : 'text-base')}>
          {`${String(Math.max(remaining, 0))} / ${String(total)}`}
        </span>
      </div>

      <ProgressBar
        value={used}
        max={safeTotal}
        size={size === 'sm' ? 'sm' : 'md'}
        tone={exhausted ? 'danger' : low ? 'warning' : 'brand'}
        label={label}
        formatValue={(value, max) => `${String(max - value)} of ${String(max)} left`}
      />

      {exhausted ? (
        <div className="flex flex-col gap-2 rounded-md bg-surface-sunken p-3">
          <p className="text-xs text-ink-muted">{exhaustedMessage}</p>
          {exhaustedAction}
        </div>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
});
