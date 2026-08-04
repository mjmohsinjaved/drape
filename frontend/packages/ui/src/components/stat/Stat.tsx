import * as React from 'react';

import { TrendingDown, TrendingUp } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** What the number is. Named by what it means to the reader (D-14). */
  label: React.ReactNode;
  /** Pre-formatted. Formatting is locale work and belongs to `@repo/utils`, not here. */
  value: React.ReactNode;
  /** Context line: the comparison period, the denominator, the caveat. */
  hint?: React.ReactNode;
  /** Signed change, already formatted, e.g. "+12%". */
  delta?: React.ReactNode;
  /** Which way is good. A falling refusal rate is good; a falling try-on count is not. */
  deltaDirection?: 'up' | 'down' | 'flat';
  deltaIsGood?: boolean;
  /** Announced with the delta, e.g. "compared with last month". */
  deltaLabel?: string;
  icon?: React.ReactNode;
}

/**
 * A single figure in the admin analytics grid.
 *
 * `<dl>` markup, so the label and value are associated for assistive tech rather than being two
 * unrelated pieces of text that happen to sit near each other.
 */
export const Stat = React.forwardRef<HTMLDivElement, StatProps>(function Stat(
  {
    className,
    label,
    value,
    hint,
    delta,
    deltaDirection = 'flat',
    deltaIsGood = true,
    deltaLabel,
    icon,
    ...props
  },
  ref,
) {
  const tone =
    deltaDirection === 'flat'
      ? 'text-ink-muted'
      : deltaIsGood
        ? 'text-success'
        : 'text-danger';

  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 rounded-md border border-line bg-surface p-4', className)}
      {...props}
    >
      <dl className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-xs font-medium text-ink-muted">{label}</dt>
          {icon ? (
            <span aria-hidden="true" className="text-ink-subtle [&_svg]:size-4">
              {icon}
            </span>
          ) : null}
        </div>
        <dd className="text-2xl font-semibold tabular-nums text-ink">{value}</dd>
      </dl>

      {delta ? (
        <p className={cn('flex items-center gap-1 text-xs font-medium', tone)}>
          {deltaDirection === 'up' ? (
            <TrendingUp aria-hidden="true" className="size-3.5" />
          ) : deltaDirection === 'down' ? (
            <TrendingDown aria-hidden="true" className="size-3.5" />
          ) : null}
          {delta}
          {deltaLabel ? <VisuallyHidden>{` ${deltaLabel}`}</VisuallyHidden> : null}
        </p>
      ) : null}

      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
});
