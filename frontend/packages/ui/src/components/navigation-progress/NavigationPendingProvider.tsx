'use client';

import * as React from 'react';

/**
 * How long a navigation must stay unresolved before the bar is allowed to appear.
 *
 * A prefetched route segment usually resolves in well under 100 ms, and a bar that paints and
 * vanishes inside two frames reads as a glitch rather than as feedback — worse than no bar at
 * all. 120 ms is above that band and still well below the ~250 ms at which a delay starts to be
 * felt as the interface not responding, so a genuinely slow navigation loses nothing.
 */
export const NAV_PROGRESS_SHOW_DELAY_MS = 120;

/**
 * Once shown, the bar stays for at least this long.
 *
 * Without a floor, a navigation that resolves at 130 ms would show the bar for 10 ms — the
 * strobe the delay was meant to prevent, moved rather than removed. 320 ms is long enough to be
 * seen and read as "the app is working", and it covers `--duration-base` (220 ms) of growth plus
 * `--duration-fast` (140 ms) of fade with no overlap between the two.
 */
export const NAV_PROGRESS_MIN_VISIBLE_MS = 320;

export interface NavigationPendingContextValue {
  /**
   * True once at least one navigation has been pending for `NAV_PROGRESS_SHOW_DELAY_MS`, and
   * for at least `NAV_PROGRESS_MIN_VISIBLE_MS` after that. This is the single signal the bar
   * and its live region both read, so what is seen and what is announced cannot diverge.
   */
  visible: boolean;
  /** Report one pending navigation. Call the returned function when it settles. */
  register: () => () => void;
  /**
   * The app's pending indicator, injected here rather than imported.
   *
   * `@repo/ui` never imports `next/link` — routing belongs to the app — but `Button` has to be
   * able to put an indicator *inside* the link it is slotted onto, because `useLinkStatus()` is
   * only readable from there. So the app supplies the component and the design system places it.
   * Null outside a provider: a button in isolation renders exactly as it always did.
   */
  LinkPending: React.ComponentType | null;
}

const NavigationPendingContext = React.createContext<NavigationPendingContextValue>({
  visible: false,
  register: () => () => undefined,
  LinkPending: null,
});

export interface NavigationPendingProviderProps {
  children: React.ReactNode;
  /** The app's `useLinkStatus()`-reading indicator. See `LinkPending` above. */
  linkPending?: React.ComponentType;
  /** Overridable for tests. Production uses the exported constants. */
  showDelayMs?: number;
  minVisibleMs?: number;
}

/**
 * The counter behind the app-wide navigation progress bar.
 *
 * `useLinkStatus()` is per-link and can only be read from inside a `<Link>`, so there is no one
 * place that knows a route transition is in flight. Every pending link reports in here instead,
 * and the bar renders while the count is above zero — subject to the delay and the hold, which
 * live here rather than in the bar so that a second navigation starting during the hold extends
 * the same bar instead of restarting it.
 *
 * It is a counter, not a store: nothing outside this file needs to know *which* link is pending.
 */
export function NavigationPendingProvider({
  children,
  linkPending = undefined,
  showDelayMs = NAV_PROGRESS_SHOW_DELAY_MS,
  minVisibleMs = NAV_PROGRESS_MIN_VISIBLE_MS,
}: NavigationPendingProviderProps) {
  const [pendingCount, setPendingCount] = React.useState(0);
  const [visible, setVisible] = React.useState(false);
  const shownAt = React.useRef(0);

  const register = React.useCallback(() => {
    setPendingCount((count) => count + 1);
    // Guarded so a double-invoked effect cleanup (StrictMode, or an unmount racing a settle)
    // cannot drive the count negative and strand the bar on screen.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setPendingCount((count) => Math.max(0, count - 1));
    };
  }, []);

  React.useEffect(() => {
    if (pendingCount > 0) {
      // Already up: a second link starting mid-flight joins the bar rather than restarting it.
      if (visible) return undefined;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, showDelayMs);
      // Settling inside the window clears this before it fires — which is the whole point: the
      // bar is never mounted for a navigation the user experienced as instant.
      return () => {
        clearTimeout(timer);
      };
    }

    if (!visible) return undefined;

    const remaining = Math.max(0, minVisibleMs - (Date.now() - shownAt.current));
    const timer = setTimeout(() => {
      setVisible(false);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [pendingCount, visible, showDelayMs, minVisibleMs]);

  const value = React.useMemo<NavigationPendingContextValue>(
    () => ({ visible, register, LinkPending: linkPending ?? null }),
    [visible, register, linkPending],
  );

  return (
    <NavigationPendingContext.Provider value={value}>{children}</NavigationPendingContext.Provider>
  );
}

/** Read the shared pending state. Safe outside a provider — reports idle and registers nothing. */
export function useNavigationPending(): NavigationPendingContextValue {
  return React.useContext(NavigationPendingContext);
}

/**
 * Hold one registration open for as long as `pending` is true.
 *
 * The caller owns the `useLinkStatus()` read; this owns the bookkeeping, so no call site has to
 * remember to release a counter it incremented.
 */
export function useReportNavigationPending(pending: boolean): void {
  const { register } = useNavigationPending();

  React.useEffect(() => {
    if (!pending) return undefined;
    return register();
  }, [pending, register]);
}
