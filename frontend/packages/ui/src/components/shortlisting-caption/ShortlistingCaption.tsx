import * as React from 'react';

import { Info } from 'lucide-react';

import { cn } from '../../lib/cn';

export interface ShortlistingCaptionProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The translated caption. Pass the `ur` and `en` strings from `i18n/messages`.
   *
   * If you omit it, the English default below is used. It is written to pass the §8.3 copy
   * check: it does not promise accuracy, it frames the render as indicative, it never says "see
   * yourself in", and it makes the shortlisting purpose explicit.
   */
  children?: React.ReactNode;
  variant?: 'inline' | 'overlay';
}

const DEFAULT_CAPTION =
  'This is an approximate guide to help you shortlist. Fabric fall, embroidery detail and length will differ in person.';

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
        <p className="text-pretty">{children ?? DEFAULT_CAPTION}</p>
      </div>
    );
  },
);

/** Exported so a test can assert the shipped English copy has not drifted. */
export { DEFAULT_CAPTION as SHORTLISTING_CAPTION_EN };
