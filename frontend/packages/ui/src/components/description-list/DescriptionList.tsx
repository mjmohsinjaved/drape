import * as React from 'react';

import { cn } from '../../lib/cn';

export interface DescriptionListProps extends React.HTMLAttributes<HTMLDListElement> {
  /**
   * `stacked` puts the term above the value — right on a phone.
   * `inline` puts them side by side from `sm` upward — the admin detail pane.
   */
  layout?: 'stacked' | 'inline';
  density?: 'comfortable' | 'scale';
}

/**
 * Term/value pairs: garment metadata, enquiry details, audit entries.
 *
 * Real `<dl>`/`<dt>`/`<dd>` markup. A two-column grid of `<div>`s looks identical and tells a
 * screen-reader user nothing about which value belongs to which label.
 */
export const DescriptionList = React.forwardRef<HTMLDListElement, DescriptionListProps>(
  function DescriptionList({ className, layout = 'stacked', density = 'comfortable', ...props }, ref) {
    return (
      <dl
        ref={ref}
        data-layout={layout}
        className={cn(
          'w-full',
          density === 'scale' ? 'gap-stack text-density' : 'gap-3 text-sm',
          'grid',
          layout === 'inline' ? 'sm:grid-cols-[minmax(8rem,auto)_1fr] sm:gap-x-6' : 'grid-cols-1',
          className,
        )}
        {...props}
      />
    );
  },
);

export interface DescriptionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  term: React.ReactNode;
  /** Falls back to an em dash so a missing value never reads as a broken layout. */
  children?: React.ReactNode;
  /** Use the mono face — ids, SKUs, references, audit metadata (§6.1, admin only). */
  mono?: boolean;
}

export function DescriptionItem({
  className,
  term,
  children,
  mono = false,
  ...props
}: DescriptionItemProps): React.JSX.Element {
  return (
    <div className={cn('grid grid-cols-subgrid gap-0.5 sm:col-span-2', className)} {...props}>
      <dt className="text-xs font-medium text-ink-muted">{term}</dt>
      <dd className={cn('text-ink', mono && 'font-mono text-xs')}>
        {children ?? <span className="text-ink-subtle">&#8212;</span>}
      </dd>
    </div>
  );
}
