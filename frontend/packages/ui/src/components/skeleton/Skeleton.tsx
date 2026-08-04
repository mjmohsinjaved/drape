import * as React from 'react';

import { cn } from '../../lib/cn';
import { type AspectRatioName, resolveRatio } from '../aspect-ratio/AspectRatio';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The aspect ratio of the content this skeleton stands in for — a named product ratio
   * (`garment`, `render`, `square`, …) or a raw width/height number.
   *
   * D-8: skeletons match the aspect ratio of the content they replace, so cumulative layout
   * shift stays under 0.1 on the catalog and result screens. A skeleton without a ratio is only
   * correct for content whose height you have already fixed some other way.
   */
  ratio?: AspectRatioName | number;
  /** Shape of the placeholder. `text` draws a line at the current font size. */
  variant?: 'block' | 'text' | 'circle';
  /** For `variant="text"`: how many lines. The last line is short, the way real text ends. */
  lines?: number;
  /** Turn off the sheen for a dense list where twenty animating rows would be noise. */
  animate?: boolean;
}

/**
 * The loading placeholder. Always reserve the real geometry: a skeleton that is the wrong shape
 * is worse than no skeleton, because the content jumps when it lands (D-8).
 *
 * It is `aria-hidden` and inert — the announcement belongs to the surrounding `<LoadingState>`,
 * which owns one polite live region for the whole screen rather than one per box.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { className, ratio, variant = 'block', lines = 3, animate = true, style, ...props },
  ref,
) {
  const base = cn(
    'bg-skeleton',
    animate ? 'skeleton-sheen' : '',
    variant === 'circle' ? 'rounded-full' : 'rounded-md',
  );

  if (variant === 'text') {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn('flex w-full flex-col gap-2', className)}
        style={style}
        {...props}
      >
        {Array.from({ length: Math.max(1, lines) }, (_, index) => (
          <span
            key={index}
            className={cn(
              base,
              'block h-[1em] w-full rounded-xs',
              index === lines - 1 && lines > 1 ? 'w-3/5' : '',
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(base, 'w-full', className)}
      style={
        ratio === undefined
          ? style
          : { aspectRatio: String(resolveRatio(ratio)), ...style }
      }
      {...props}
    />
  );
});
