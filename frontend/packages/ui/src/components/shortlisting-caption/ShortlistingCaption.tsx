import * as React from 'react';

import { Info } from 'lucide-react';

import { cn } from '../../lib/cn';

export interface ShortlistingCaptionProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * The translated caption — **required, and there is no English fallback**.
   *
   * `@repo/ui` has no access to `next-intl`, so a default string here could only ever be one
   * language. A caption that silently renders English to an `ur` reader is worse than a build
   * error, and C-20 makes this the one line that must always be readable: it is where the
   * promise that Drape shortlists rather than previews is actually kept.
   *
   * Pass `t('…')` from the calling screen's namespace. The copy must pass the §8.3 / §9.4 check
   * in **both** locales: indicative, never a promise of accuracy, never "see yourself in".
   */
  children: React.ReactNode;
  variant?: 'inline' | 'overlay';
}

/**
 * The persistent, non-dismissible caption that sits with every rendered try-on (C-20, §8.3).
 *
 * It is a component rather than a per-screen string for one reason: **so it can never be omitted
 * or reworded on one screen.** There is no `onDismiss`, no `collapsed` prop and no variant that
 * hides it — that is the point, not an oversight.
 *
 * Drape is a shortlisting tool, not a preview tool. This caption is where that promise is kept.
 */
export const ShortlistingCaption = React.forwardRef<HTMLDivElement, ShortlistingCaptionProps>(
  function ShortlistingCaption({ className, children, variant = 'inline', ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex items-start gap-2 text-xs',
          variant === 'inline' && 'rounded-md bg-surface-sunken p-3 text-ink-muted',
          variant === 'overlay' && 'rounded-md bg-overlay p-3 text-canvas backdrop-blur-sm',
          className,
        )}
        {...props}
      >
        <Info aria-hidden="true" className="mt-px size-4 shrink-0" />
        <p className="text-pretty">{children}</p>
      </div>
    );
  },
);
