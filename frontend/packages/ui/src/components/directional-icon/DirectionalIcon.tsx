'use client';

import * as React from 'react';

import { cn } from '../../lib/cn';
import { useDirection } from '../../providers/theme-provider';

export interface DirectionalIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The icon element. One child. */
  children: React.ReactNode;
}

/**
 * The single place in the codebase where reading direction touches rendering (§6.7).
 *
 * Chevrons, arrows and back buttons point along the reading direction, so they mirror with
 * `scaleX(-1)` under `rtl`. Icons that are not directional — search, trash, plus, camera —
 * never flip and must not be wrapped in this.
 *
 *   <DirectionalIcon><ChevronRight aria-hidden /></DirectionalIcon>
 *
 * Everything else about direction is handled by logical properties. There are no `[dir='rtl']`
 * selectors anywhere in Drape, and this component is why none are needed.
 */
export const DirectionalIcon = React.forwardRef<HTMLSpanElement, DirectionalIconProps>(
  function DirectionalIcon({ className, children, ...props }, ref) {
    const dir = useDirection();

    return (
      <span
        ref={ref}
        aria-hidden="true"
        className={cn('inline-flex shrink-0', dir === 'rtl' && '-scale-x-100', className)}
        {...props}
      >
        {children}
      </span>
    );
  },
);
