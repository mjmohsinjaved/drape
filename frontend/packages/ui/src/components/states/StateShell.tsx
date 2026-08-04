import * as React from 'react';

import { cn } from '../../lib/cn';

// `title` is omitted from the DOM attributes: here it is the state's heading, a
// ReactNode, not the browser's tooltip string.
export interface StateShellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Decorative illustration or icon. Always `aria-hidden` — the heading carries the meaning. */
  icon?: React.ReactNode;
  /** The heading. One line, sentence case, active voice (D-12). */
  title: React.ReactNode;
  /** One or two sentences. What happened, or what this screen is for. */
  description?: React.ReactNode;
  /** The primary action, and at most one secondary beside it. */
  action?: React.ReactNode;
  /** Anything below the action — a support link, a shortcut hint. */
  footer?: React.ReactNode;
  /** `page` centres in a full screen; `inline` fits inside a card or a table body. */
  size?: 'page' | 'inline';
  /** Heading level. Pick what the document outline needs (D-20). */
  headingLevel?: 'h2' | 'h3' | 'h4';
  /** Tone of the icon halo. */
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
}

const toneClasses: Record<NonNullable<StateShellProps['tone']>, string> = {
  neutral: 'bg-surface-sunken text-ink-subtle',
  brand: 'bg-brand-tint text-brand',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  info: 'bg-info-tint text-info',
};

/**
 * The shared skeleton of the six D-5 states. Not exported from the package root — use the six
 * named states, which is how the required set stays visible in a screen's imports and in review.
 */
export const StateShell = React.forwardRef<HTMLDivElement, StateShellProps>(function StateShell(
  {
    className,
    icon,
    title,
    description,
    action,
    footer,
    size = 'page',
    headingLevel = 'h2',
    tone = 'neutral',
    children,
    ...props
  },
  ref,
) {
  const Heading = headingLevel;

  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center text-center',
        size === 'page' && 'gap-4 px-6 py-16',
        size === 'inline' && 'gap-3 px-4 py-10',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-full',
            size === 'page' ? 'size-16 [&_svg]:size-7' : 'size-12 [&_svg]:size-5',
            toneClasses[tone],
          )}
        >
          {icon}
        </span>
      ) : null}

      <div className="flex max-w-prose flex-col gap-1.5">
        <Heading
          className={cn(
            'font-display font-semibold text-balance text-ink',
            size === 'page' ? 'text-2xl' : 'text-xl',
          )}
        >
          {title}
        </Heading>
        {description ? <p className="text-sm text-pretty text-ink-muted">{description}</p> : null}
      </div>

      {children}

      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
      {footer ? <div className="text-xs text-ink-subtle">{footer}</div> : null}
    </div>
  );
});
