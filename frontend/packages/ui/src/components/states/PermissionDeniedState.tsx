import * as React from 'react';

import { Lock } from 'lucide-react';

import { StateShell, type StateShellProps } from './StateShell';

export interface PermissionDeniedStateProps
  extends Omit<StateShellProps, 'title' | 'tone' | 'icon'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
}

/**
 * The S-9 no-access screen.
 *
 * Three rules, all from §8.2:
 * - plain language, not a raw 403;
 * - a link back to the fitting room, so the user is not stranded;
 * - **it never reveals whether the resource exists.** The copy is identical for "this garment is
 *   not yours" and "this garment is not a thing", and the component takes no id, no name and no
 *   resource type for exactly that reason.
 *
 * Authorisation is decided in the API. This is presentation of a decision already made.
 */
export const PermissionDeniedState = React.forwardRef<HTMLDivElement, PermissionDeniedStateProps>(
  function PermissionDeniedState(
    {
      title = 'This page is not available to your account',
      description = 'Your account does not have access to this page. Head back to the fitting room and carry on from there.',
      ...props
    },
    ref,
  ) {
    return (
      <StateShell
        ref={ref}
        data-state="denied"
        tone="neutral"
        icon={<Lock />}
        title={title}
        description={description}
        {...props}
      />
    );
  },
);
