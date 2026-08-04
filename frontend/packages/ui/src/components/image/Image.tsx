'use client';

import NextImage, { type ImageProps as NextImageProps } from 'next/image';
import * as React from 'react';

import { ImageOff } from 'lucide-react';

import { cn } from '../../lib/cn';
import { AspectRatio, type AspectRatioName } from '../aspect-ratio/AspectRatio';

export interface ImageProps extends Omit<NextImageProps, 'alt'> {
  /**
   * REQUIRED, and required by the type, not by a lint rule. Alt text on every render and every
   * catalog image is a PRD requirement, not a nicety (D-20, §9.5).
   *
   * Describe the garment — "Deep red anarkali with gold zari on the hem" — not the file. Pass an
   * empty string only when the image is genuinely decorative and the meaning is already in the
   * surrounding text.
   */
  alt: string;
}

/**
 * `next/image` with the alt text made non-optional.
 *
 * Everything else — sizes, priority, loader — is passed straight through, because those are page
 * decisions and the design system should not be guessing at them.
 */
export const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  { className, ...props },
  ref,
) {
  return <NextImage ref={ref} className={cn('object-cover', className)} {...props} />;
});

export interface ImageWithFallbackProps extends ImageProps {
  /** Ratio of the reserved box. Keeps the fallback the same size as the image (D-8). */
  ratio?: AspectRatioName | number;
  /** Shown when the image fails. Defaults to a quiet placeholder, never a broken-image glyph. */
  fallback?: React.ReactNode;
  /** Announced with the fallback. Says what happened, not "error". */
  fallbackLabel?: string;
  /** Rounding of the box. `render` viewers use --radius-xs so nothing visibly crops (§6.1). */
  rounded?: 'none' | 'xs' | 'md' | 'lg' | 'xl';
}

const roundedClass = {
  none: '',
  xs: 'rounded-xs',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
} as const;

/**
 * The image every screen should actually use.
 *
 * Three things it guarantees: the box is reserved before the bytes arrive, so nothing shifts
 * (D-8); a failed load becomes a designed placeholder instead of the browser's broken icon; and
 * the alt text is compulsory.
 *
 * Signed URLs expire — a placeholder that reads as deliberate is the difference between "this
 * link has gone stale" and "this site is broken".
 */
export const ImageWithFallback = React.forwardRef<HTMLImageElement, ImageWithFallbackProps>(
  function ImageWithFallback(
    {
      className,
      ratio = 'garment',
      fallback,
      fallbackLabel = 'This image is not available',
      rounded = 'lg',
      onError,
      ...props
    },
    ref,
  ) {
    const [failed, setFailed] = React.useState(false);

    // A new src is a new attempt.
    React.useEffect(() => {
      setFailed(false);
    }, [props.src]);

    return (
      <AspectRatio ratio={ratio} className={cn('bg-surface-sunken', roundedClass[rounded], className)}>
        {failed ? (
          (fallback ?? (
            <div className="flex size-full flex-col items-center justify-center gap-2 text-ink-subtle">
              <ImageOff aria-hidden="true" className="size-6" />
              <span className="px-4 text-center text-xs">{fallbackLabel}</span>
            </div>
          ))
        ) : (
          <Image
            ref={ref}
            {...props}
            fill={props.fill ?? true}
            className="size-full object-cover"
            onError={(event) => {
              setFailed(true);
              onError?.(event);
            }}
          />
        )}
      </AspectRatio>
    );
  },
);
