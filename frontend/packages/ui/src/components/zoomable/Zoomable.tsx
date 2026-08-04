'use client';

import * as React from 'react';

import { Minus, Plus, RotateCcw } from 'lucide-react';

import { cn } from '../../lib/cn';
import { IconButton } from '../icon-button/IconButton';

export interface ZoomableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The image or render to inspect. */
  children: React.ReactNode;
  /** Accessible name for the zoom region. */
  label: string;
  minScale?: number;
  maxScale?: number;
  step?: number;
  zoomInLabel?: string;
  zoomOutLabel?: string;
  resetLabel?: string;
  /** Hide the on-screen controls — pointer gestures and keys still work. */
  hideControls?: boolean;
}

/**
 * Pinch, double-tap and scroll zoom for the result view and the catalog detail image (C-20).
 *
 * Three input methods, because the render is the thing people came to look at:
 * - touch: pinch, and double-tap to toggle between fit and 2x;
 * - pointer: Ctrl/⌘ + wheel, and drag to pan once zoomed;
 * - keyboard: `+` / `-` / `0`, plus the visible buttons — a zoom control that only responds to
 *   a pinch excludes every desktop keyboard user (D-20).
 *
 * `touch-action: none` is applied only while zoomed in, so an un-zoomed image never traps the
 * page scroll under a thumb.
 */
export function Zoomable({
  className,
  children,
  label,
  minScale = 1,
  maxScale = 4,
  step = 0.5,
  zoomInLabel = 'Zoom in',
  zoomOutLabel = 'Zoom out',
  resetLabel = 'Fit to screen',
  hideControls = false,
  ...props
}: ZoomableProps): React.JSX.Element {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const dragOrigin = React.useRef<{ x: number; y: number } | null>(null);

  const clamp = (next: number): number => Math.min(Math.max(next, minScale), maxScale);

  const reset = (): void => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const zoomBy = (delta: number): void => {
    setScale((current) => {
      const next = clamp(current + delta);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  return (
    <div className={cn('relative flex flex-col gap-2', className)} {...props}>
      <div
        role="group"
        aria-label={label}
        tabIndex={0}
        className={cn(
          'relative overflow-hidden rounded-xs bg-surface-sunken',
          'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
          scale > 1 ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-zoom-in',
        )}
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomBy(step);
          } else if (event.key === '-') {
            event.preventDefault();
            zoomBy(-step);
          } else if (event.key === '0') {
            event.preventDefault();
            reset();
          }
        }}
        onDoubleClick={() => (scale > 1 ? reset() : setScale(clamp(2)))}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? step : -step);
        }}
        onPointerDown={(event) => {
          if (scale <= 1) return;
          dragOrigin.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const origin = dragOrigin.current;
          if (!origin) return;
          setOffset({ x: event.clientX - origin.x, y: event.clientY - origin.y });
        }}
        onPointerUp={() => {
          dragOrigin.current = null;
        }}
      >
        <div
          className="origin-center transition-[scale] duration-fast ease-out"
          style={{
            scale: String(scale),
            translate: `${String(offset.x)}px ${String(offset.y)}px`,
          }}
        >
          {children}
        </div>
      </div>

      {hideControls ? null : (
        <div className="flex items-center justify-center gap-1">
          <IconButton
            size="md"
            variant="secondary"
            label={zoomOutLabel}
            icon={<Minus />}
            disabled={scale <= minScale}
            onClick={() => zoomBy(-step)}
          />
          <IconButton
            size="md"
            variant="secondary"
            label={resetLabel}
            icon={<RotateCcw />}
            disabled={scale === 1 && offset.x === 0 && offset.y === 0}
            onClick={reset}
          />
          <IconButton
            size="md"
            variant="secondary"
            label={zoomInLabel}
            icon={<Plus />}
            disabled={scale >= maxScale}
            onClick={() => zoomBy(step)}
          />
        </div>
      )}
    </div>
  );
}
