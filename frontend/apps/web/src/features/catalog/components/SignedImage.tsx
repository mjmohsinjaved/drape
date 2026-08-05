'use client';

import { ImageWithFallback, cn, type AspectRatioName } from '@repo/ui';

export interface SignedImageProps {
  /** A signed, expiring URL from the API (§3.4). Never a storage key. */
  src: string | null;
  /** D-20: describe the piece, not the photograph. `''` only for a genuinely decorative image. */
  alt: string;
  ratio?: AspectRatioName | number;
  rounded?: 'none' | 'xs' | 'md' | 'lg' | 'xl';
  className?: string;
  fallbackLabel: string;
  /** Rendered when there is no URL at all — a garment with no images yet. */
  emptyLabel: string;
  sizes?: string;
}

/**
 * Every catalog image in the console goes through here, `unoptimized` on purpose.
 *
 * `GET /files/:token` serves against an HMAC token, and a `sub`-scoped token additionally
 * requires a matching session cookie (§3.4). Next's image optimiser fetches the URL from the
 * server with no cookie jar, so an optimised admin thumbnail would 401 and render as a broken
 * box. `unoptimized` lets the browser fetch it directly, with the session it already has.
 *
 * It also avoids caching an optimised copy of a URL that expires in minutes.
 */
/** Spelled out rather than interpolated, so Tailwind's scanner can see every class. */
const ROUNDED_CLASS = {
  none: '',
  xs: 'rounded-xs',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
} as const;

export function SignedImage({
  src,
  alt,
  ratio = 'garment',
  rounded = 'md',
  className,
  fallbackLabel,
  emptyLabel,
  sizes,
}: SignedImageProps) {
  if (src === null) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border border-line bg-surface-sunken p-1 text-center text-2xs text-ink-subtle',
          ROUNDED_CLASS[rounded],
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <ImageWithFallback
      src={src}
      alt={alt}
      ratio={ratio}
      rounded={rounded}
      unoptimized
      sizes={sizes}
      fallbackLabel={fallbackLabel}
      className={className}
    />
  );
}
