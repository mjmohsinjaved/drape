'use client';

import { cn } from '../../lib/cn';
import { VisuallyHidden } from '../visually-hidden/VisuallyHidden';

export interface NavigationProgressProps {
  /**
   * Whether a route transition is in flight *and* has been long enough to be worth showing.
   * The delay and the hold belong to `NavigationPendingProvider`; this component only draws.
   */
  active: boolean;
  /**
   * The accessible name of the progress element and the text of the live region. Name what is
   * happening — "Loading the next page" — not the widget.
   */
  label: string;
  /**
   * D-11. When set, the bar fades in at its final width instead of creeping: no indeterminate
   * sliding animation, which is the one thing the preference is about.
   */
  reducedMotion?: boolean;
  className?: string;
}

/**
 * The app-wide route-transition indicator — a 2 px bar pinned to the top of the viewport.
 *
 * ═══ Why it is an overlay ═══
 *
 * It is `fixed` and `pointer-events-none`, so it occupies no space in the document and cannot
 * move a pixel of content. A progress bar that pushed the page down when it appeared and pulled
 * it back up when it left would be a layout shift on every single navigation — the CLS budget is
 * 0.1 for the whole session (D-8), and that alone would spend it.
 *
 * ═══ Why it fills from the reading-start edge ═══
 *
 * The fill is a block child with a percentage `inline-size`, which CSS places at the container's
 * inline start. In `en` it grows from the left; in `ur` it grows from the right. There is no
 * transform to mirror and no `[dir='rtl']` selector — §6.7 forbids both.
 *
 * ═══ Why the announcement is tied to `active` ═══
 *
 * The live region carries the label only while the bar is up, and the bar is only up once the
 * navigation has outlived the delay. A user tabbing quickly through a prefetched nav therefore
 * hears nothing at all, rather than "Loading" once per keystroke (D-20).
 */
export function NavigationProgress({
  active,
  label,
  reducedMotion = false,
  className,
}: NavigationProgressProps) {
  return (
    <>
      <div
        aria-hidden={!active}
        data-state={active ? 'loading' : 'idle'}
        className={cn(
          // `inset-x-0 top-0` is symmetric and block-direction only: nothing here is a
          // reading-direction decision, so nothing here needs mirroring.
          'pointer-events-none fixed inset-x-0 top-0 z-50 h-1',
          'transition-opacity duration-fast ease-out',
          active ? 'opacity-100' : 'opacity-0',
          className,
        )}
      >
        {active ? (
          <div
            role="progressbar"
            aria-label={label}
            aria-busy="true"
            className="h-full w-full overflow-hidden"
          >
            <div
              className={cn(
                'h-full rounded-e-full bg-brand',
                // The creep is a keyframe on `inline-size`. Under the reduced-motion branch the
                // bar is simply there at its full width and the only motion left is the
                // container's opacity fade.
                reducedMotion ? 'w-full' : 'nav-progress-fill',
              )}
            />
          </div>
        ) : null}
      </div>

      {/*
        One polite region for the whole app. It is a sibling of the bar rather than a child of
        it, so the text survives the bar's own mount/unmount and is not re-announced when the
        progressbar element is swapped in.
      */}
      <VisuallyHidden role="status" aria-live="polite">
        {active ? label : ''}
      </VisuallyHidden>
    </>
  );
}
