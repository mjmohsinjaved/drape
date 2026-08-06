'use client';

import { useLinkStatus } from 'next/link';

import { Spinner, useReportNavigationPending } from '@repo/ui';
import { cn } from '@repo/utils';

export interface LinkPendingProps {
  /** `sm` matches the spinner `Button` shows when it is `loading`; `xs` suits a nav row. */
  size?: 'xs' | 'sm';
  /**
   * `inline` sits in the flow, where the button's own leading icon would be.
   *
   * `corner` is absolutely positioned at the block-start/inline-end of the nearest positioned
   * ancestor, so an item that has no room to spare — a bottom tab, a collapsed sidebar rail —
   * gains an indicator without a single pixel moving. The ancestor must be `relative`.
   */
  placement?: 'inline' | 'corner';
  className?: string;
}

/**
 * The per-item answer to a click: what the user pressed shows that it heard them.
 *
 * It must be rendered *inside* a `next/link` — `useLinkStatus()` reads a context that `<Link>`
 * publishes around its own children, and reports idle (rather than throwing) anywhere else. That
 * is why this is a component and not a hook the link's parent could call.
 *
 * It does two jobs at once. It draws the indicator, and it reports the pending navigation to the
 * app-wide counter that raises the progress bar at the top of the viewport — so one placement
 * covers both the local and the global feedback, and the two can never disagree about whether a
 * navigation is in flight.
 *
 * It is `aria-hidden` on purpose. `NavigationProgress` owns the single polite live region for
 * navigation, and it is delayed; a per-item `role="status"` would announce the same fact again,
 * once per link, with no delay at all (D-20).
 */
export function LinkPending({ size = 'sm', placement = 'inline', className }: LinkPendingProps) {
  const { pending } = useLinkStatus();
  useReportNavigationPending(pending);

  if (!pending) return null;

  return (
    <span
      aria-hidden="true"
      // Read by the `pending-dim` utility on the ancestor control, which cannot be told any
      // other way: the element that knows is inside the element that needs to react.
      data-nav-pending=""
      className={cn(
        'pointer-events-none inline-flex items-center justify-center',
        placement === 'corner' && 'absolute end-1 top-1',
        className,
      )}
    >
      <Spinner size={size} label={null} />
    </span>
  );
}
