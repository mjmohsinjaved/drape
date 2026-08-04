import * as React from 'react';

import { Slot } from '@radix-ui/react-slot';

import { cn } from '../../lib/cn';

export interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Render the single child element instead of a <span>, e.g. an <h2> the design does not show. */
  asChild?: boolean;
}

/**
 * Removes content from the visual layout while leaving it in the accessibility tree.
 *
 * This is not `display: none` and not `hidden` — both of those remove the content from screen
 * readers too, which is the opposite of the point. Used for icon-button labels, table captions,
 * and the heading structure the design does not show but the document outline needs (D-20).
 */
export const VisuallyHidden = React.forwardRef<HTMLSpanElement, VisuallyHiddenProps>(
  function VisuallyHidden({ asChild = false, className, ...props }, ref) {
    const Component = asChild ? Slot : 'span';

    return (
      <Component
        ref={ref}
        className={cn(
          'absolute size-px overflow-hidden whitespace-nowrap border-0 p-0',
          '[clip:rect(0,0,0,0)] [clip-path:inset(50%)]',
          // Not `left: -9999px`: that breaks under RTL and scrolls the viewport on focus.
          '-m-px',
          className,
        )}
        {...props}
      />
    );
  },
);
