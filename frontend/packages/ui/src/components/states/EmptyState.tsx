import * as React from 'react';

import { StateShell, type StateShellProps } from './StateShell';

export interface EmptyStateProps extends Omit<StateShellProps, 'action' | 'title'> {
  /**
   * The heading. Name the next step, not the absence: "Add your first piece", never "No garments
   * found" (D-6).
   */
  title: React.ReactNode;
  /**
   * REQUIRED, and required on purpose. An empty state that only reports emptiness is a defect
   * (D-6): a consumer with no shortlist must see how to start, an admin with no garments must
   * see how to add the first.
   *
   * If you genuinely cannot offer an action, the screen is wrong — not this prop.
   */
  action: React.ReactNode;
}

/**
 * Empty is a stage in a task, not an error. It gets the same care as the populated screen.
 *
 * Copy check before you ship the strings (§8.3): active voice, sentence case, name what the
 * control does, and remember Drape is a shortlisting tool — an empty shortlist invites the user
 * to try pieces on, it never promises them a preview of how something will look.
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { tone = 'brand', ...props },
  ref,
) {
  return <StateShell ref={ref} data-state="empty" tone={tone} {...props} />;
});
