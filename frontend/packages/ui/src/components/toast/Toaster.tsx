'use client';

import * as React from 'react';

import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Toaster as SonnerToaster, toast } from 'sonner';

import { useDirection, useTheme } from '../../providers/theme-provider';

export interface ToasterProps extends React.ComponentProps<typeof SonnerToaster> {
  /** Screen-reader label for the notification region. Translate it. */
  regionLabel?: string;
}

/**
 * Mount once, inside the providers. Toasts are styled entirely with tokens, so they follow the
 * colour mode and the runtime brand override like everything else.
 *
 * Placement is `top-center` on a phone: a bottom toast collides with the consumer tab bar and
 * with the iOS home indicator. Direction comes from `<DirectionProvider>`, so the close button
 * and the icon sit on the correct side in `ur` without a second configuration.
 *
 * A toast is for a confirmation the user can ignore. Anything that must be read belongs in a
 * `Callout`; anything that must be decided belongs in an `AlertDialog`.
 */
export function Toaster({
  regionLabel = 'Notifications',
  position = 'top-center',
  ...props
}: ToasterProps): React.JSX.Element {
  const { resolvedMode } = useTheme();
  const dir = useDirection();

  return (
    <SonnerToaster
      theme={resolvedMode}
      dir={dir}
      position={position}
      containerAriaLabel={regionLabel}
      // Long enough to read a sentence in either script, short enough not to linger.
      duration={5000}
      gap={8}
      offset={16}
      icons={{
        success: <CheckCircle2 className="size-4 text-success" />,
        error: <AlertCircle className="size-4 text-danger" />,
        warning: <AlertTriangle className="size-4 text-warning" />,
        info: <Info className="size-4 text-info" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-start gap-3 rounded-lg border border-line bg-surface-raised p-4 text-sm text-ink shadow-lg',
          title: 'font-medium text-ink',
          description: 'text-xs text-ink-muted',
          actionButton:
            'ms-auto inline-flex min-h-9 items-center rounded-md bg-brand px-3 text-xs font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
          cancelButton:
            'inline-flex min-h-9 items-center rounded-md px-3 text-xs font-medium text-ink-muted hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
          closeButton:
            'rounded-md border border-line bg-surface text-ink-subtle hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        },
      }}
      {...props}
    />
  );
}

/**
 * The toast API, re-exported so screens import notifications from `@repo/ui` alongside
 * everything else and never depend on `sonner` directly.
 *
 * Copy rule (D-13): confirm in the same words as the action. The control that says Publish
 * produces "Published", not "Success!".
 */
export { toast };
export type { ExternalToast } from 'sonner';
