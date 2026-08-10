'use client';

import * as React from 'react';

import { cn } from '../../lib/cn';
import { ImageWithFallback } from '../image/Image';

import type { AspectRatioName } from '../aspect-ratio/AspectRatio';

export interface GalleryImage {
  id: string;
  src: string;
  /** Required. Describe the garment and the view — "Back view, gold zari border" (D-20). */
  alt: string;
  /**
   * Required. The thumbnail tab's accessible name, already translated — "View image 2" (C-41).
   *
   * A string on the image rather than a `(image, index) => string` prop, and that is the whole
   * point. This is a client component and the only caller is a server component, so a callback
   * here is a function crossing the server boundary: React refuses to serialise it and the
   * entire garment screen renders as the D-5 error state instead. A default of
   * `View image ${n}` did not help either — it is English under `ur`.
   *
   * Labels are therefore built where the translator already lives, next to `alt`.
   */
  thumbnailLabel: string;
}

export interface ImageGalleryProps extends React.HTMLAttributes<HTMLDivElement> {
  images: readonly GalleryImage[];
  /** Controlled index. Leave unset for internal state. */
  index?: number;
  onIndexChange?: (index: number) => void;
  ratio?: AspectRatioName | number;
  /** Accessible name for the thumbnail strip. */
  label?: string;
}

/**
 * The garment detail gallery: one large image and a thumbnail strip.
 *
 * The strip is a tablist, so Left/Right move between views and only one thumbnail is in the tab
 * order — the same pattern as `Tabs`, because that is exactly what this is. Radix's direction
 * context makes the arrow keys follow the visual order in `ur`.
 */
export const ImageGallery = React.forwardRef<HTMLDivElement, ImageGalleryProps>(
  function ImageGallery(
    {
      className,
      images,
      index,
      onIndexChange,
      ratio = 'garment',
      label = 'Garment images',
      ...props
    },
    ref,
  ) {
    const [innerIndex, setInnerIndex] = React.useState(0);
    const current = index ?? innerIndex;

    const select = (next: number): void => {
      if (index === undefined) setInnerIndex(next);
      onIndexChange?.(next);
    };

    const active = images[current] ?? images[0];
    if (!active) return <div ref={ref} className={className} {...props} />;

    return (
      <div ref={ref} className={cn('flex flex-col gap-3', className)} {...props}>
        <ImageWithFallback
          key={active.id}
          src={active.src}
          alt={active.alt}
          ratio={ratio}
          rounded="lg"
          sizes="(min-width: 768px) 50vw, 100vw"
          priority
        />

        {images.length > 1 ? (
          <div role="tablist" aria-label={label} className="flex gap-2 overflow-x-auto pb-1">
            {images.map((image, position) => (
              <button
                key={image.id}
                type="button"
                role="tab"
                aria-selected={position === current}
                aria-label={image.thumbnailLabel}
                tabIndex={position === current ? 0 : -1}
                onClick={() => select(position)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    select((current + 1) % images.length);
                  } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    select((current - 1 + images.length) % images.length);
                  }
                }}
                className={cn(
                  'size-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
                  position === current ? 'border-brand' : 'border-transparent hover:border-line-strong',
                )}
              >
                <ImageWithFallback
                  src={image.src}
                  alt=""
                  ratio="square"
                  rounded="none"
                  sizes="64px"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  },
);
