import * as React from 'react';

import { cn } from '../../lib/cn';

export interface DefaultStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The populated screen. */
  children: React.ReactNode;
}

/**
 * The populated, working screen — the first of the six D-5 states.
 *
 * It exists so that the state set is complete and greppable. A screen written as
 *
 *   {state === 'loading' ? <LoadingState … />
 *    : state === 'error' ? <ErrorState … />
 *    : state === 'empty' ? <EmptyState … />
 *    : state === 'denied' ? <PermissionDeniedState … />
 *    : <DefaultState>{…}</DefaultState>}
 *
 * shows in one glance whether all six were considered. A screen with only its default state is
 * incomplete (D-5), and the easiest way to catch that in review is to make the default state
 * look like the others.
 *
 * It renders a plain wrapper and adds nothing else.
 */
export const DefaultState = React.forwardRef<HTMLDivElement, DefaultStateProps>(
  function DefaultState({ className, ...props }, ref) {
    return <div ref={ref} data-state="default" className={cn('w-full', className)} {...props} />;
  },
);
