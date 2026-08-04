import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export const calloutVariants = cva('flex w-full gap-3 rounded-lg border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-info/25 bg-info-tint text-ink',
      success: 'border-success/25 bg-success-tint text-ink',
      warning: 'border-warning/25 bg-warning-tint text-ink',
      danger: 'border-danger/25 bg-danger-tint text-ink',
    },
  },
  defaultVariants: { tone: 'info' },
});

const toneIcon = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
} as const;

const toneIconColour = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

export interface CalloutProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof calloutVariants> {
  /** One line, sentence case. */
  title?: React.ReactNode;
  /** Replace the default icon, or pass `null` to drop it. */
  icon?: React.ReactNode | null;
  /** Buttons or links, below the copy. */
  action?: React.ReactNode;
  /** Makes it dismissible. */
  onDismiss?: () => void;
  dismissLabel?: string;
}

/**
 * An in-page message that stays put: consent required, quota exhausted, a garment no longer
 * available, the "best on a larger screen" notice on the admin catalog editor.
 *
 * `danger` and `warning` announce themselves as alerts; `info` and `success` do not, because a
 * page that interrupts a screen-reader user for every neutral notice is unusable.
 *
 * Not for transient confirmations — those are toasts. Not for blocking decisions — those are
 * `AlertDialog`.
 */
export const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  { className, tone = 'info', title, icon, action, onDismiss, dismissLabel = 'Dismiss', children, ...props },
  ref,
) {
  const resolvedTone = tone ?? 'info';
  const Icon = toneIcon[resolvedTone];
  const assertive = resolvedTone === 'danger' || resolvedTone === 'warning';

  return (
    <div
      ref={ref}
      role={assertive ? 'alert' : 'status'}
      className={cn(calloutVariants({ tone }), className)}
      {...props}
    >
      {icon === null ? null : (
        <span aria-hidden="true" className={cn('mt-px shrink-0', toneIconColour[resolvedTone])}>
          {icon ?? <Icon className="size-5" />}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <p className="font-semibold text-ink">{title}</p> : null}
        {children ? <div className="text-ink-muted">{children}</div> : null}
        {action ? <div className="mt-1 flex flex-wrap gap-2">{action}</div> : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            '-m-2 inline-flex size-11 shrink-0 items-center justify-center self-start rounded-md',
            'text-ink-subtle transition-colors duration-fast hover:bg-surface/60 hover:text-ink',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
          )}
        >
          <X aria-hidden="true" className="size-4" />
          <VisuallyHidden>{dismissLabel}</VisuallyHidden>
        </button>
      ) : null}
    </div>
  );
});

/**
 * `Alert` is the same component. The name exists because "alert" is what most callers reach for;
 * keeping one implementation stops the codebase from growing two banner styles.
 */
export const Alert = Callout;
export type AlertProps = CalloutProps;

export interface InlineErrorProps extends React.HTMLAttributes<HTMLParagraphElement> {
  children: React.ReactNode;
}

/**
 * A one-line error beside a control that is not inside a `FormField` — a failed inline edit, a
 * row-level failure in a bulk operation (D-16).
 *
 * Inside a form, use `FormError`: it wires `aria-describedby` and `aria-invalid`, which this
 * cannot do because it does not know the control.
 */
export const InlineError = React.forwardRef<HTMLParagraphElement, InlineErrorProps>(
  function InlineError({ className, children, ...props }, ref) {
    return (
      <p
        ref={ref}
        role="alert"
        className={cn('flex items-start gap-1.5 text-xs font-medium text-danger', className)}
        {...props}
      >
        <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>{children}</span>
      </p>
    );
  },
);
