import * as React from 'react';

import { CheckCircle2 } from 'lucide-react';

import { StateShell, type StateShellProps } from './StateShell';

export interface SuccessStateProps extends Omit<StateShellProps, 'tone' | 'icon'> {
  /**
   * Confirm in the same words as the action that caused it: the control that says Publish
   * confirms Published (D-13). Not "Success!", not "Done".
   */
  title: React.ReactNode;
  /** The undo, or the next step. One of the two exists on nearly every success worth showing. */
  action?: React.ReactNode;
}

/**
 * The D-5 success state.
 *
 * `role="status"` so the confirmation is announced without stealing focus — a success screen
 * that grabs focus interrupts a user who has already moved on.
 */
export const SuccessState = React.forwardRef<HTMLDivElement, SuccessStateProps>(
  function SuccessState(props, ref) {
    return (
      <StateShell
        ref={ref}
        data-state="success"
        role="status"
        aria-live="polite"
        tone="success"
        icon={<CheckCircle2 />}
        {...props}
      />
    );
  },
);
