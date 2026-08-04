import * as React from 'react';

import { cn } from '../../lib/cn';

export interface WatermarkPreviewProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The image being marked. */
  children: React.ReactNode;
  /** Short mark text — the brand name. Repeated across the surface. */
  text: string;
  opacity?: number;
  density?: 'sparse' | 'normal';
}

/**
 * Shows how a shared or downloaded render will be watermarked.
 *
 * The mark is a decorative overlay, `aria-hidden` and pointer-transparent: it must not be read
 * out over the alt text and it must not swallow the zoom gesture underneath. It is a preview of
 * a server-side mark, never the mark itself — anything applied in the browser can be removed in
 * the browser.
 */
export const WatermarkPreview = React.forwardRef<HTMLDivElement, WatermarkPreviewProps>(
  function WatermarkPreview(
    { className, children, text, opacity = 0.14, density = 'normal', ...props },
    ref,
  ) {
    const rows = density === 'sparse' ? 3 : 5;
    const columns = density === 'sparse' ? 2 : 3;

    return (
      <div ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
        {children}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex flex-col justify-around"
          style={{ opacity }}
        >
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex justify-around">
              {Array.from({ length: columns }, (_, column) => (
                <span
                  key={column}
                  className="text-xs font-semibold tracking-[0.04em] whitespace-nowrap text-canvas uppercase mix-blend-difference"
                  style={{ rotate: '-24deg' }}
                >
                  {text}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  },
);
