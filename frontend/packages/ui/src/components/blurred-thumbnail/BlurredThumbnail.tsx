'use client';

import * as React from 'react';

import { Eye, EyeOff } from 'lucide-react';

import { cn } from '../../lib/cn';
import { type AspectRatioName } from '../aspect-ratio/AspectRatio';
import { ImageWithFallback } from '../image/Image';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface BlurredThumbnailProps extends React.HTMLAttributes<HTMLDivElement> {
  src: string;
  /** Required. Describe what the item is, not what it might contain. */
  alt: string;
  ratio?: AspectRatioName | number;
  /** Start revealed. Default is blurred: the moderator opts in, every time. */
  defaultRevealed?: boolean;
  revealLabel?: string;
  hideLabel?: string;
  /** Why it is blurred, e.g. "Flagged for review". */
  reason?: React.ReactNode;
}

/**
 * The moderation queue thumbnail.
 *
 * Blurred until the moderator chooses to look, and re-blurrable in one press. Reviewing reported
 * imagery is someone's job for hours at a time; the default has to be "not yet" and the way back
 * has to be immediate.
 *
 * The reveal is per item and resets on every mount — a queue never renders a screen of
 * already-revealed images because one was opened earlier.
 */
export const BlurredThumbnail = React.forwardRef<HTMLDivElement, BlurredThumbnailProps>(
  function BlurredThumbnail(
    {
      className,
      src,
      alt,
      ratio = 'square',
      defaultRevealed = false,
      revealLabel = 'Show this image',
      hideLabel = 'Blur this image',
      reason,
      ...props
    },
    ref,
  ) {
    const [revealed, setRevealed] = React.useState(defaultRevealed);

    return (
      <div ref={ref} className={cn('relative overflow-hidden rounded-md', className)} {...props}>
        <div className={cn('transition-[filter] duration-base ease-out', !revealed && 'blur-xl')}>
          <ImageWithFallback src={src} alt={revealed ? alt : ''} ratio={ratio} rounded="md" sizes="160px" />
        </div>

        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center',
            'transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
            revealed
              ? 'bg-transparent opacity-0 hover:opacity-100 focus-visible:opacity-100'
              : 'bg-overlay text-canvas',
          )}
        >
          {revealed ? (
            <EyeOff aria-hidden="true" className="size-5 text-canvas" />
          ) : (
            <Eye aria-hidden="true" className="size-5" />
          )}
          {!revealed && reason ? <span className="text-2xs">{reason}</span> : null}
          <VisuallyHidden>{revealed ? hideLabel : revealLabel}</VisuallyHidden>
        </button>
      </div>
    );
  },
);
