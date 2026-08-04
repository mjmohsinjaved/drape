import * as React from 'react';

import { cn } from '../../lib/cn';
import { Skeleton } from '../skeleton/Skeleton';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

import type { AspectRatioName } from '../aspect-ratio/AspectRatio';

export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Announced once, politely. Name what is loading — "Loading your try-ons" — so a screen-reader
   * user knows which part of the page is busy.
   */
  label: string;
  /**
   * Which shape to draw. A full-screen spinner is not a loading state (D-5): the placeholder has
   * to match the layout it replaces or the content jumps when it lands (D-8).
   *
   * `custom` renders `children` instead, for a layout none of these fit.
   */
  layout?: 'grid' | 'list' | 'detail' | 'form' | 'custom';
  /** Number of placeholder items. Match the real page size. */
  count?: number;
  /** Aspect ratio for the media in `grid` and `detail`. */
  ratio?: AspectRatioName | number;
}

/**
 * The D-5 loading state.
 *
 * One polite live region for the whole screen; the skeletons themselves are `aria-hidden`, so a
 * screen reader hears "Loading your try-ons" once rather than forty times.
 *
 * For the seven-second try-on wait, do not use this — that moment needs staged, progressing
 * microcopy the user can navigate away from (PRD §10.3, C-27), which is a feature-level
 * component, not a generic shell.
 */
export const LoadingState = React.forwardRef<HTMLDivElement, LoadingStateProps>(
  function LoadingState(
    { className, label, layout = 'grid', count = 8, ratio = 'garment', ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        data-state="loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn('w-full', className)}
        {...props}
      >
        <VisuallyHidden>{label}</VisuallyHidden>

        {layout === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6 xl:grid-cols-4">
            {Array.from({ length: count }, (_, index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton ratio={ratio} className="rounded-lg" />
                <Skeleton variant="text" lines={2} />
              </div>
            ))}
          </div>
        ) : null}

        {layout === 'list' ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: count }, (_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-md p-3">
                <Skeleton className="size-10 shrink-0 rounded-md" />
                <Skeleton variant="text" lines={2} className="flex-1" />
              </div>
            ))}
          </div>
        ) : null}

        {layout === 'detail' ? (
          <div className="flex flex-col gap-6 md:flex-row md:gap-10">
            <Skeleton ratio={ratio} className="rounded-lg md:flex-1" />
            <div className="flex flex-1 flex-col gap-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton variant="text" lines={4} />
              <Skeleton className="h-11 w-40 rounded-md" />
            </div>
          </div>
        ) : null}

        {layout === 'form' ? (
          <div className="flex flex-col gap-5">
            {Array.from({ length: count }, (_, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28 rounded-xs" />
                <Skeleton className="h-11 w-full rounded-md" />
              </div>
            ))}
          </div>
        ) : null}

        {layout === 'custom' ? props.children : null}
      </div>
    );
  },
);
